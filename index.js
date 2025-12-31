/* 
Received data from MQTT Broker and forwards data via Websocket to Frontend 
*/

require('dotenv').config();
const { authorizeGoogleSheets, logToSheet, readRecentFromSheet, readReplayFeed, readTradesFromSheet } = require('./logToSheets');
const { shouldSkipDay, getRiskProfile, getMaxHoldMinutes } = require('./solarStrategy');
const TradeManager = require('./tradeManager');
const mqtt = require('mqtt');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const alpaca = require('./alpaca'); // Alpaca Module to fetch account infos
const { createTickerMessages } = require('./tickerTape');
const { appendJsonl } = require('./localLog');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Accept JSON POSTS from devices (ESP32)
app.use(express.json());

// MQTT toggle (default OFF). Set ENABLE_MQTT=true to enable.
const ENABLE_MQTT = process.env.ENABLE_MQTT === 'true';
let mqttClient = null;
const topic = 'energy/audrey';
if (ENABLE_MQTT) {
  const mqttUrl = process.env.MQTT_URL || 'mqtt://tigoe.net';
  mqttClient = mqtt.connect(mqttUrl, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
  });
  console.log(`🔌 MQTT enabled. Connecting to ${mqttUrl}...`);
} else {
  console.log('🔌 MQTT disabled (set ENABLE_MQTT=true to enable).');
}

// Conditionally enable Google Sheets only if credentials are provided
const SHEETS_ENABLED = !!process.env.GOOGLE_CREDENTIALS;

let lastReading = null;
const sensorHistory = [];
const HISTORY_STORE_LIMIT = Number(process.env.HISTORY_STORE_LIMIT || 500);
// Send all collected history by default; override with HISTORY_SEND_LIMIT if needed
const HISTORY_SEND_LIMIT = process.env.HISTORY_SEND_LIMIT ? Number(process.env.HISTORY_SEND_LIMIT) : Infinity;
const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Seoul';
const LOCALE = process.env.LOCALE || 'ko-KR';

// Replay mode configuration
const REPLAY_MODE = process.env.MODE === 'replay' || process.env.REPLAY_MODE === 'true';
const REPLAY_SHEET = process.env.REPLAY_SHEET || 'Replay Feed';
const REPLAY_FETCH_LIMIT = Number(process.env.REPLAY_FETCH_LIMIT || 500);
const REPLAY_SPEED = Number(process.env.REPLAY_SPEED || 1);
const REPLAY_LOOP = process.env.REPLAY_LOOP === 'true';
const TRADE_REPLAY_LIMIT = Number(process.env.TRADE_REPLAY_LIMIT || 300);

// Initialize Google Sheets and seed history (async)
if (SHEETS_ENABLED) {
  (async function initSheets() {
    try {
      await authorizeGoogleSheets();
      // After authorization completes, seed history
      const recent = await readRecentFromSheet(HISTORY_STORE_LIMIT, 'DayTrader Log');
      if (recent.length > 0) {
        sensorHistory.splice(0, sensorHistory.length, ...recent); // replace in-place
        lastReading = sensorHistory[0];
        console.log(`🗂️ Seeded sensor history from Sheets: ${sensorHistory.length} entries`);
      } else {
        console.log('🗂️ No prior history found in Sheets (or read failed).');
      }
    } catch (err) {
      console.error('Error initializing Google Sheets:', err.message);
    }
  })();
} else {
  console.log('📝 Google Sheets disabled (set GOOGLE_CREDENTIALS to enable).');
}

let tradeMood = null;
let marketOpen = false;
let powerZeroCount = 0;
let powerPositiveCount = 0;
let tradeManager = null;
let lastMarketCloseTime = 0;
const MARKET_COOLDOWN_MINUTES = 15;
let tradingInterval = null;
const loggedSkips = new Set(); // ✅ Track skipped trades

const moodStockMap = {
  "Bright & Dry": ["MSFT", "GOOG"], // Clear tech leaders
  "Cold & Bright": ["INTC", "IBM"], // Established tech with measured growth
  "Hot & Dry": ["SPWR", "SEDG"], // Solar energy, capturing heat
  "Hot & Humid": ["DASH", "UBER"], // Fast-moving delivery
  "Dark & Wet": ["NEE", "WM"], // Utilities, waste management - essentials
  "Dry & Cloudy": ["PFE", "ABT"], // Healthcare, stability in uncertainty
  "Bright & Wet": ["NKE", "LULU"], // Activewear, thriving after rain
  "Cold & Wet": ["TGT", "COST"] // Retail basics, essentials
};

// const moodStockMap = {
//   "Bright & Dry": ["TSLA", "NVDA", "META", "SHOP", "AAPL", "MSFT", "AMZN", "GOOGL"],
//   "Cold & Bright": ["PLTR", "UBER", "ABNB", "NET", "ROKU", "SNOW", "DKNG"],
//   "Hot & Dry": ["AI", "UPST", "HOOD", "COIN", "AFRM", "SOFI", "LCID", "RIVN", "FSLY", "BB"],
//   "Hot & Humid": ["GME", "MARA", "RIOT", "BBBY", "CVNA", "AMC", "OSTK", "SPCE", "BBIG", "DWAC"],
//   "Dark & Wet": ["SPY", "JNJ", "PG", "KO", "PEP", "VZ", "WMT", "XLP", "XLU"],
//   "Dry & Cloudy": ["TLT", "XLU", "GLD", "XLF", "XLE", "USO", "BND"],
//   "Bright & Wet": ["DIS", "SQ", "SOFI", "PYPL", "ZM", "LYFT", "WISH"],
//   "Cold & Wet": []
// };

const moodNameMap = {
  "Bright & Dry": "Golden Clarity (아지랑이)",
  "Dark & Wet": "Black Rain (그런 날도 있는거다)",
  "Cold & Bright": "Crispy Breeze (여름이었ㄷr..)",
  "Hot & Humid": "Hazy Surge (눈 찌르는 무더위)",
  "Cold & Wet": "Still Waters (이슬비가 내리는 날이면)",
  "Hot & Dry": "Rising Sun (TVXQ)",
  "Dry & Cloudy": "Wind Cries Mary (장미꽃 향기는 바람에 날리고)",
  "Bright & Wet": "Sunshower (여우비)"
};

function determineTradeMood({ lux, temperature, humidity }) {
  const isBright = lux > 20000;
  const isDark = lux <= 20000;
  const isHot = temperature > 15;
  const isCold = temperature < 15;
  const isDry = humidity < 50;
  const isWet = humidity > 50;

  if (isBright && isDry && isHot) return "Hot & Dry";
  if (isBright && isDry && isCold) return "Cold & Bright";
  if (isDark && isWet && isCold) return "Cold & Wet";
  if (isDark && isWet && isHot) return "Hot & Humid";
  if (isBright && isWet && isCold) return "Bright & Wet";
  if (isDark && isDry) return "Dry & Cloudy";
  if (isBright && isDry) return "Bright & Dry";
  if (isDark && isWet) return "Dark & Wet";

  return "Unknown";
}

function isMarketHours() {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  
  // Check if it's a weekday (Monday-Friday)
  if (day === 0 || day === 6) {
    return false; // Weekend
  }
  
  // Check if it's between 9:30 AM and 4:00 PM ET
  const marketOpen = hour > 9 || (hour === 9 && minute >= 30);
  const marketClosed = hour >= 16;
  
  return marketOpen && !marketClosed;
}

// Normalize incoming timestamps to epoch milliseconds (server-trusted clock, TZ aware)
function normalizeTimestamp(input) {
  const nowMs = Date.now();
  // Default: use server time
  let tsMs = nowMs;

  // Try to parse incoming, but clamp if unreasonable
  if (input != null) {
    let candidate;
    if (typeof input === 'string') {
      const parsed = Date.parse(input);
      if (!isNaN(parsed)) candidate = parsed;
    } else if (typeof input === 'number') {
      // If looks like seconds (<= 1e11), scale to ms
      candidate = input < 1e11 ? input * 1000 : input;
    }

    if (Number.isFinite(candidate)) {
      tsMs = candidate;
    }
  }

  // Reject obviously wrong years (too far past/future)
  const year = new Date(tsMs).getFullYear();
  const currentYear = new Date(nowMs).getFullYear();
  if (year < 2015 || year > currentYear + 1) {
    console.warn('⏱️ Invalid year in timestamp, falling back to server time', {
      input,
      parsed: tsMs,
      year,
      nowMs
    });
    tsMs = nowMs;
  }

  // If incoming timestamp is too far ( >24h drift ), trust server now
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(tsMs - nowMs) > ONE_DAY_MS) {
    console.warn('⏱️ Timestamp drift >24h, using server time', {
      input,
      parsed: tsMs,
      nowMs
    });
    tsMs = nowMs;
  }

  return tsMs;
}

// Unified handler for incoming sensor data (MQTT or HTTP POST)
async function handleSensorData(data) {
  console.log('📥 Received sensor data:', JSON.stringify(data));
  const now = Date.now();
  // Accept multiple timestamp keys from devices; fall back to server time if missing
  const incomingTs = data.timeStamp ?? data.timestamp ?? data.ts ?? data.time;
  const msgTsMs = normalizeTimestamp(incomingTs);
  // Derive date strictly from the message timestamp in NY time
  const today = new Date(msgTsMs).toLocaleDateString('en-US', { timeZone: 'America/New_York' });

  if (data.power === 0) {
    powerZeroCount++;
    powerPositiveCount = 0;
  } else {
    powerZeroCount = 0;
    powerPositiveCount++;
  }

  const timeSinceLastClose = (now - lastMarketCloseTime) / 60000;
  const inMarketHours = isMarketHours();

  if (powerPositiveCount >= 5 && !marketOpen && timeSinceLastClose >= MARKET_COOLDOWN_MINUTES && inMarketHours) {
    marketOpen = true;
    io.emit('marketStatus', { open: true });

    tradeMood = determineTradeMood(data);
    const suggestedStocks = moodStockMap[tradeMood] || [];

    io.emit('weatherMood', { mood: moodNameMap[tradeMood] ?? tradeMood });
    io.emit('suggestedStocks', { stocks: suggestedStocks });

    if (shouldSkipDay(data.lux, data.humidity, data.temperature)) {
      console.log('🌫️ Skipping trades: too dark, humid and cold.');
      return; // Exit early, skip this cycle
    }
    if (tradeMood !== "Cold & Wet" && suggestedStocks.length > 0) {
      try {
        const account = await alpaca.getAccountInfo(); // Fetch account info from Alpaca
        const cash = parseFloat(account.cash); // safer + clearer for trading logic
        console.log('📈 Alpaca cash balance:', cash);
        tradeManager = new TradeManager(cash);
        const buyingPower = parseFloat(account.buying_power);
        console.log('📈 Alpaca buying power:', buyingPower);

        if (isNaN(cash)) {
          throw new Error('⚠️ Received NaN for cash balance');
        }
      } catch (err) {
        console.error('❌ Failed to fetch account info from Alpaca:', err.message); 
        tradeManager = new TradeManager(100000); // fallback to paper balance
      }

      tradingInterval = setInterval(async () => {
        for (const symbol of suggestedStocks) {
          const result = await tradeManager.evaluateTradeEntry(
            symbol,
            tradeMood,
            data.lux,
            data.temperature,
            data.humidity
          );
          
          if (result?.executed) {
            console.log(`✅ TRADE EXECUTED: ${symbol}`);
          } else {
            console.log(`⏭️ Skipped ${symbol}: ${result?.reason}`);
          }

          if (!result?.executed && result?.reason) {
            const key = `${today}-${symbol}`;
            if (!loggedSkips.has(key)) {
              loggedSkips.add(key);
              const timeNow = new Date().toLocaleString(LOCALE, { timeZone: TIME_ZONE });
              try {
                await logToSheet([
                  timeNow,
                  symbol,
                  "Skipped",
                  result.reason,
                  data.lux,
                  data.temperature,
                  data.humidity,
                  tradeMood,
                  "—"
                ], 'Skipped Trades');
              } catch (err) {
                console.error('Error logging to sheet:', err);
              }
            }
          }
        }

        await tradeManager.updateOpenTrades();
      }, 60_000);
    }
  }

  if (powerZeroCount >= 5 && marketOpen) {
    io.emit('marketStatus', { open: false });
    if (tradingInterval) {
      clearInterval(tradingInterval);
      tradingInterval = null;
    }
    marketOpen = false;
    powerZeroCount = 0;
    powerPositiveCount = 0;
    lastMarketCloseTime = now;
    loggedSkips.clear(); // ✅ Reset skip tracking at market close
    if (tradeManager) {
      await tradeManager.forceCloseAll();
    }
  }

  const formatted = {
    time: new Date(msgTsMs).toLocaleString(LOCALE, {
      timeZone: TIME_ZONE
    }),
    date: new Date(msgTsMs).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }),
    // Include the normalized timestamp for debugging
    timeStamp: msgTsMs,
    temperature: data.temperature ?? '—',
    humidity: data.humidity ?? '—',
    lux: data.lux ?? '—',
    current: data.current ?? '—',
    power: data.power ?? '—',
    battery: data.battery ?? '—',
    mood: moodNameMap[tradeMood] ?? tradeMood
  };

  lastReading = formatted;
  sensorHistory.unshift(formatted);
  if (sensorHistory.length > HISTORY_STORE_LIMIT) sensorHistory.pop();

  const historyToSend = HISTORY_SEND_LIMIT === Infinity
    ? [...sensorHistory]
    : sensorHistory.slice(0, HISTORY_SEND_LIMIT);

  io.emit('mqttData', {
    latest: lastReading,
    history: historyToSend
  });

  try {
    const values = [
      formatted.time,
      data.lux,
      data.temperature,
      data.humidity,
      data.current,
      data.power,
      data.battery,
      formatted.mood,
      (moodStockMap[tradeMood] || []).join(', ')
    ];

    await logToSheet(values);
    console.log('📝 Logged to DayTrader Log');

    // Also log to Replay Feed with raw timestamp for replay
    if (SHEETS_ENABLED) {
      const tsIso = new Date(msgTsMs).toISOString();
      const tsLocal = formatted.time;
      await logToSheet([
        msgTsMs,
        tsIso,
        tsLocal,
        data.lux,
        data.temperature,
        data.humidity,
        data.current,
        data.power,
        data.battery,
        formatted.mood
      ], REPLAY_SHEET);
      console.log('📝 Logged to Replay Feed');
    }

    // Optional JSONL local backup
    if (process.env.LOG_JSONL === 'true') {
      const dateStr = new Date(msgTsMs).toISOString().split('T')[0];
      appendJsonl(`replay-${dateStr}.jsonl`, {
        tsMs: msgTsMs,
        tsIso: new Date(msgTsMs).toISOString(),
        tsLocal: formatted.time,
        lux: data.lux,
        temperature: data.temperature,
        humidity: data.humidity,
        current: data.current,
        power: data.power,
        battery: data.battery,
        mood: formatted.mood
      });
    }
  } catch (err) {
    console.error('❌ Error logging to sheet:', err.message);
    console.error('Stack:', err.stack);
  }
}

// Replay mode: disable MQTT and HTTP ingest
if (REPLAY_MODE) {
  console.log('🎬 REPLAY MODE ENABLED - MQTT and HTTP ingest disabled');
} else {
  if (ENABLE_MQTT && mqttClient) {
    mqttClient.on('connect', () => {
      // console.log('✅ Connected to MQTT broker');
      mqttClient.subscribe(topic);
    });
  }

  // ADDED: Error handling for MQTT connection
  if (ENABLE_MQTT && mqttClient) {
    mqttClient.on('error', (err) => {
      console.error('❌ MQTT connection error:', err);
    });
  }

  if (ENABLE_MQTT && mqttClient) {
    mqttClient.on('message', async (topic, message) => {
      const msg = message.toString();
      try {
        const data = JSON.parse(msg);
        await handleSensorData(data);
      } catch (err) {
        // console.log('❌ Invalid JSON:', msg);
      }
    });
  }
}

// ADDED: Enhanced connection event handler with fallback data
io.on('connection', socket => {
  console.log('🔌 New client connected');

  if (lastReading || sensorHistory.length > 0) {
    const historyToSend = HISTORY_SEND_LIMIT === Infinity
      ? [...sensorHistory]
      : sensorHistory.slice(0, HISTORY_SEND_LIMIT);

    socket.emit('mqttData', {
      latest: lastReading ?? sensorHistory[0],
      history: historyToSend
    });
  } else {
    // ADDED: Provide fallback data if no real data is available
    console.log('No sensor data available, sending dummy data');
    const dummyData = {
      time: new Date().toLocaleString(LOCALE, { timeZone: TIME_ZONE }),
      temperature: 22,
      humidity: 45,
      lux: 15000,
      current: 250,
      power: 1200,
      battery: 85,
      mood: "Golden Clarity (아지랑이)"
    };
    
    socket.emit('mqttData', {
      latest: dummyData,
      history: [dummyData]
    });
    
    socket.emit('weatherMood', { mood: dummyData.mood });
    socket.emit('suggestedStocks', { stocks: ["MSFT", "GOOG"] });
  }

  if (tradeMood) {
    socket.emit('weatherMood', { mood: moodNameMap[tradeMood] ?? tradeMood });
    socket.emit('suggestedStocks', { stocks: moodStockMap[tradeMood] || [] });
  }

  socket.emit('marketStatus', { open: marketOpen });
});

// Replay mode: read and replay sensor data + trades
async function startReplayMode() {
  if (!SHEETS_ENABLED) {
    console.error('❌ Replay mode requires Google Sheets (set GOOGLE_CREDENTIALS)');
    return;
  }

  console.log('🎬 Starting replay mode...');
  const sensorData = await readReplayFeed(REPLAY_FETCH_LIMIT, REPLAY_SHEET);
  const trades = await readTradesFromSheet(TRADE_REPLAY_LIMIT, 'Alpaca Trades');

  if (sensorData.length === 0) {
    console.warn('⚠️ No replay data found in sheet');
    return;
  }

  // Sort by timestamp (oldest first for replay)
  sensorData.sort((a, b) => a.tsMs - b.tsMs);
  trades.sort((a, b) => (a.tsMs || 0) - (b.tsMs || 0));

  console.log(`📊 Loaded ${sensorData.length} sensor readings and ${trades.length} trades`);

  // Send all trades at once to new connections
  if (trades.length > 0) {
    io.emit('replayTrades', { trades });
  }

  let sensorIdx = 0;
  let tradeIdx = 0;
  let lastEmittedTs = null;

  async function replayNext() {
    if (sensorIdx >= sensorData.length) {
      if (REPLAY_LOOP) {
        console.log('🔄 Replay loop - restarting from beginning');
        sensorIdx = 0;
        tradeIdx = 0;
        lastEmittedTs = null;
      } else {
        console.log('✅ Replay complete');
        return;
      }
    }

    const sensor = sensorData[sensorIdx];
    if (!sensor || !sensor.tsMs) {
      sensorIdx++;
      return replayNext();
    }

    // Emit trades that occurred before this sensor reading
    while (tradeIdx < trades.length && trades[tradeIdx].tsMs && trades[tradeIdx].tsMs <= sensor.tsMs) {
      io.emit('replayTrade', trades[tradeIdx]);
      tradeIdx++;
    }

    // Calculate delay based on actual time gaps (or use fixed interval)
    let delay = 1000 / REPLAY_SPEED; // default 1 second per reading
    if (lastEmittedTs && sensor.tsMs > lastEmittedTs) {
      const actualGap = sensor.tsMs - lastEmittedTs;
      delay = Math.max(100, actualGap / REPLAY_SPEED); // respect original timing, scaled by speed
    }

    // Format and emit sensor data
    const formatted = {
      time: sensor.tsLocal || new Date(sensor.tsMs).toLocaleString(LOCALE, { timeZone: TIME_ZONE }),
      date: new Date(sensor.tsMs).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }),
      timeStamp: sensor.tsMs,
      temperature: sensor.temperature ?? '—',
      humidity: sensor.humidity ?? '—',
      lux: sensor.lux ?? '—',
      current: sensor.current ?? '—',
      power: sensor.power ?? '—',
      battery: sensor.battery ?? '—',
      mood: sensor.mood ?? '—'
    };

    lastReading = formatted;
    sensorHistory.unshift(formatted);
    if (sensorHistory.length > HISTORY_STORE_LIMIT) sensorHistory.pop();

    const historyToSend = HISTORY_SEND_LIMIT === Infinity
      ? [...sensorHistory]
      : sensorHistory.slice(0, HISTORY_SEND_LIMIT);

    io.emit('mqttData', {
      latest: lastReading,
      history: historyToSend
    });

    // Update mood if available
    const moodKey = Object.keys(moodNameMap).find(k => moodNameMap[k] === sensor.mood);
    if (moodKey) {
      tradeMood = moodKey;
      io.emit('weatherMood', { mood: sensor.mood });
      io.emit('suggestedStocks', { stocks: moodStockMap[moodKey] || [] });
    }

    lastEmittedTs = sensor.tsMs;
    sensorIdx++;

    setTimeout(replayNext, delay);
  }

  replayNext();
}

if (REPLAY_MODE) {
  startReplayMode();
}

app.use(express.static('public'));

// Two-line ticker API for LED panel integration
app.get('/api/ticker', async (req, res) => {
  try {
    const toNum = v => (typeof v === 'number' ? v : (Number(v) || 0));
    const sensor = lastReading ? {
      lux: toNum(lastReading.lux),
      temperature: toNum(lastReading.temperature),
      humidity: toNum(lastReading.humidity),
      current: toNum(lastReading.current),
      power: toNum(lastReading.power)
    } : { lux: 0, temperature: 0, humidity: 0, current: 0, power: 0 };
    
    const mood = tradeMood;
    const suggestedStocks = moodStockMap[tradeMood] || [];
    const rp = getRiskProfile(sensor.lux);
    const hold = getMaxHoldMinutes(sensor.humidity);
    const risk = { takeProfitPct: rp.takeProfit, stopLossPct: rp.stopLoss, holdMinutes: hold };
    
    // Fetch minimal account info for cash display
    let account = null;
    try {
      const acct = await alpaca.getAccountInfo();
      if (acct && (acct.cash != null)) {
        account = { cash: acct.cash };
      }
    } catch (err) {
      // continue without account
    }
    
    let position = null;
    if (tradeManager && tradeManager.openTrades && tradeManager.openTrades.length > 0) {
      const t = tradeManager.openTrades[0];
      let tpPct, slPct;
      if (t.side === 'long') {
        tpPct = ((t.tpPrice / t.entryPrice) - 1) * 100;
        slPct = (1 - (t.slPrice / t.entryPrice)) * 100;
      } else {
        tpPct = (1 - (t.tpPrice / t.entryPrice)) * 100;
        slPct = ((t.slPrice / t.entryPrice) - 1) * 100;
      }
      position = {
        symbol: t.symbol,
        side: t.side,
        entryPrice: t.entryPrice,
        size: t.shares,
        entryTime: t.entryTime,
        maxHoldMinutes: t.maxHoldMinutes,
        tpPct,
        slPct
      };
    }
    
    // Consider market "open" if:
    // - server state says open, OR
    // - it's within market hours, OR
    // - there is an active position
    const hasActivePosition = !!(tradeManager && tradeManager.openTrades && tradeManager.openTrades.length > 0);
    const inferredOpen = marketOpen || isMarketHours() || hasActivePosition;
    const market = { open: inferredOpen };
    const context = { sensor, mood, suggestedStocks, risk, position, market, account };
    const messages = createTickerMessages(context);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test route to check if API is working
app.get('/api/test', (req, res) => {
  // ADDED: More detailed test endpoint response
  const alpacaConfigured = !!(alpaca && alpaca.alpaca);
  
  res.json({
    message: 'API is working!',
    timestamp_utc: new Date().toISOString(),
    timestamp_local: new Date().toLocaleString(LOCALE, { timeZone: TIME_ZONE }),
    date_local: new Date().toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }),
    server_tz_hint: TIME_ZONE,
    alpaca_configured: alpacaConfigured,
    env_vars_set: {
      ALPACA_API_KEY: !!process.env.ALPACA_API_KEY,
      ALPACA_SECRET_KEY: !!process.env.ALPACA_SECRET_KEY
    }
  });
});

// HTTP ingest endpoint for ESP32 to POST sensor readings (JSON)
app.post('/api/ingest', async (req, res) => {
  console.log('📨 POST /api/ingest received');
  if (REPLAY_MODE) {
    console.log('⚠️ Replay mode active - rejecting ingest');
    return res.status(403).json({ ok: false, error: 'Replay mode active - ingest disabled' });
  }
  try {
    if (!req.body || typeof req.body !== 'object') {
      console.error('❌ Invalid JSON body:', req.body);
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
    }
    console.log('✅ Processing sensor data...');
    await handleSensorData(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Ingest error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Simplified account info route with error handling
app.get('/api/account', async (req, res) => {
  try {
    // First try to get account info with existing method
    const account = await alpaca.getAccountInfo();
    console.log('Successfully retrieved account info:', account ? 'Data exists' : 'No data');
    
    // If we have account data, return it with simplified history
    if (account) {
      // Add simple dummy history data for testing
      account.history = [
        { timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), equity: parseFloat(account.equity) * 0.95 },
        { timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), equity: parseFloat(account.equity) * 0.97 },
        { timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), equity: parseFloat(account.equity) * 0.99 },
        { timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), equity: parseFloat(account.equity) * 1.01 },
        { timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), equity: parseFloat(account.equity) * 1.02 },
        { timestamp: new Date().toISOString(), equity: parseFloat(account.equity) }
      ];
      res.json(account);
    } else {
      // // Fallback to dummy data if no account info
      // res.json({
      //   equity: "100000.00",
      //   buying_power: "200000.00",
      //   cash: "100000.00",
      //   history: [
      //     { timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), equity: 95000 },
      //     { timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), equity: 97000 },
      //     { timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), equity: 99000 },
      //     { timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), equity: 101000 },
      //     { timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), equity: 102000 },
      //     { timestamp: new Date().toISOString(), equity: 100000 }
      //   ]
      // });
    }
  } catch (error) {
    console.error('Error in account API route:', error.message);
    // Return dummy data in case of any error
    // res.json({
    //   equity: "100000.00",
    //   buying_power: "200000.00",
    //   cash: "100000.00",
    //   history: [
    //     { timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), equity: 95000 },
    //     { timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), equity: 97000 },
    //     { timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), equity: 99000 },
    //     { timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), equity: 101000 },
    //     { timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), equity: 102000 },
    //     { timestamp: new Date().toISOString(), equity: 100000 }
    //   ]
    // });
  }
});

// Simplified positions route with dummy data fallback
app.get('/api/positions', async (req, res) => {
  try {
    // First try real positions
    const positions = await alpaca.alpaca.getPositions();
    console.log('Successfully retrieved positions:', positions && positions.length ? positions.length : 'No positions');
    
    if (positions && positions.length > 0) {
      res.json(positions);
    } else {
      // // Return dummy positions data
      // res.json([
      //   {
      //     symbol: "AAPL",
      //     qty: "10",
      //     avg_entry_price: "175.50",
      //     market_value: "1800.00",
      //     unrealized_pl: "50.00",
      //     unrealized_plpc: "2.86"
      //   },
      //   {
      //     symbol: "MSFT",
      //     qty: "5",
      //     avg_entry_price: "350.25",
      //     market_value: "1800.00",
      //     unrealized_pl: "48.75",
      //     unrealized_plpc: "2.78"
      //   }
      // ]);
    }
  } catch (error) {
    console.error('Error in positions API route:', error.message);
  }
});

// Simplified orders route with dummy data fallback
app.get('/api/orders', async (req, res) => {
  try {
    // First try real orders
    const orders = await alpaca.alpaca.getOrders({
      status: 'all',
      limit: 5
    });
    console.log('Successfully retrieved orders:', orders && orders.length ? orders.length : 'No orders');
    
    if (orders && orders.length > 0) {
      res.json(orders);
    } else {

    }
  } catch (error) {
    console.error('Error in orders API route:', error.message);
    // Return dummy data in case of any error

  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🌐 Server running on port ${port}`);
});