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
const { logBLEDisplay } = require('./logToSheets');
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
const REPLAY_TRADE = process.env.REPLAY_TRADE === 'true'; // Enable trading during replay
const TRADE_REPLAY_LIMIT = Number(process.env.TRADE_REPLAY_LIMIT || 300);
// Target date for replay (format: YYYY-MM-DD, e.g., "2026-01-08")
const REPLAY_TARGET_DATE = process.env.REPLAY_TARGET_DATE; // If set, use this date instead of today
// Start trading from this EST time (format: HH:MM, e.g., "09:30")
const REPLAY_START_TIME = process.env.REPLAY_START_TIME || null; // If set, only start trading from this time

// Initialize Google Sheets and seed history (async)
if (SHEETS_ENABLED) {
  (async function initSheets() {
    try {
      await authorizeGoogleSheets();
      // In replay mode, don't seed from DayTrader Log - wait for replay mode to load correct data
      if (!REPLAY_MODE) {
        // After authorization completes, seed history (only if not in replay mode)
        const recent = await readRecentFromSheet(HISTORY_STORE_LIMIT, 'DayTrader Log');
        if (recent.length > 0) {
          sensorHistory.splice(0, sensorHistory.length, ...recent); // replace in-place
          lastReading = sensorHistory[0];
          console.log(`🗂️ Seeded sensor history from Sheets: ${sensorHistory.length} entries`);
        } else {
          console.log('🗂️ No prior history found in Sheets (or read failed).');
        }
      }
      
      // Start replay mode after Google Sheets is initialized
      if (REPLAY_MODE) {
        await startReplayMode();
      }
      
      // Start BLE Display logging (1 minute interval)
      // Initial log after 5 seconds
      setTimeout(() => logCurrentTickerState(), 5000);
      
      // Then log every minute
      bleDisplayInterval = setInterval(() => {
        const now = Date.now();
        // Avoid duplicate logs within same minute
        if (typeof lastBLELogTime === 'undefined' || now - lastBLELogTime >= 60000) {
          logCurrentTickerState();
          lastBLELogTime = now;
        }
      }, 60000); // 1 minute
      console.log('📊 BLE Display logging started (1 minute interval)');
    } catch (err) {
      console.error('Error initializing Google Sheets:', err.message);
    }
  })();
} else {
  console.log('📝 Google Sheets disabled (set GOOGLE_CREDENTIALS to enable).');
  // If REPLAY_MODE is enabled but Sheets is not, show error
  if (REPLAY_MODE) {
    console.error('❌ Replay mode requires Google Sheets (set GOOGLE_CREDENTIALS to enable).');
  }
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

// Weather condition thresholds (adjust these values to change hot/cold/dry/wet/bright thresholds)
const WEATHER_THRESHOLDS = {
  BRIGHT_LUX: 20000,        // Lux > this value = Bright, <= this value = Dark
  HOT_TEMP: 23,              // Temperature > this value = Hot, <= this value = Cold
  DRY_HUMIDITY: 50           // Humidity < this value = Dry, >= this value = Wet
};

const moodStockMap = {
  "Bright & Dry": ["AAPL", "MSFT", "GOOG"]  , // Clear tech leaders
  "Cold & Bright": ["IBM", "INTC"]  , // Established tech with measured growth
  "Hot & Dry": ["SPWR", "SEDG"], // Solar energy, capturing heat
  "Hot & Humid": ["MCD", "UBER"], // Fast-moving delivery
  "Dark & Wet": ["NEE", "ADIDAS"], // Utilities, waste management - essentials
  "Dry & Cloudy": ["NKE", "LULU"], // Good for activewear
  "Bright & Wet": ["NFLX", "DIS"], // Healthcare, stability in uncertainty
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
  const isBright = lux > WEATHER_THRESHOLDS.BRIGHT_LUX;
  const isDark = lux <= WEATHER_THRESHOLDS.BRIGHT_LUX;
  const isHot = temperature > WEATHER_THRESHOLDS.HOT_TEMP;
  const isCold = temperature <= WEATHER_THRESHOLDS.HOT_TEMP;
  const isDry = humidity < WEATHER_THRESHOLDS.DRY_HUMIDITY;
  const isWet = humidity >= WEATHER_THRESHOLDS.DRY_HUMIDITY;

  if (isBright && isDry && isHot) return "Hot & Dry";
  if (isBright && isDry && isCold) return "Cold & Bright";
  if (isDark && isWet && isCold) return "Cold & Wet";
  if (isDark && isWet && isHot) return "Hot & Humid";
  if (isBright && isWet && isCold) return "Bright & Wet";
  if (isDark && isDry) return "Dry & Cloudy";
  if (isBright && isDry) return "Bright & Dry";
  if (isDark && isWet) return "Dark & Wet";

  return "Undecided";
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
async function handleSensorData(data, skipLogging = false) {
  // Only log in non-replay mode to avoid spam
  if (!REPLAY_MODE) {
    console.log('📥 Received sensor data:', JSON.stringify(data));
  }
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
            // Immediately log ORDER type to BLE Display when trade is executed
            try {
              const openTrade = tradeManager.openTrades.find(t => t.symbol === symbol && t.entryTime === Date.now() - 1000);
              if (openTrade) {
                const rp = getRiskProfile(data.lux);
                const hold = getMaxHoldMinutes(data.humidity);
                const orderData = {
                  symbol: openTrade.symbol,
                  side: openTrade.side,
                  size: openTrade.shares,
                  entryPrice: openTrade.entryPrice,
                  entryTime: openTrade.entryTime,
                  maxHoldMinutes: openTrade.maxHoldMinutes,
                  holdMinutesLeft: openTrade.maxHoldMinutes
                };
                await logCurrentTickerState('ORDER', null);
              }
            } catch (logErr) {
              console.error(`⚠️ Error logging ORDER to BLE Display: ${logErr.message}`);
            }
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

  // Skip logging if in replay mode (data already exists in sheets)
  if (!skipLogging) {
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
  // Read ALL data to ensure we get the target date's data
  // Use a very large limit to get all data, not just recent ones
  const allSensorData = await readReplayFeed(Math.max(REPLAY_FETCH_LIMIT, 10000), REPLAY_SHEET);
  const trades = await readTradesFromSheet(TRADE_REPLAY_LIMIT, 'Alpaca Trades');

  if (allSensorData.length === 0) {
    console.warn('⚠️ No replay data found in sheet');
    return;
  }

  // Filter to target date's KST data to use for trading
  // 로직: 매일 그날 한국 데이터로 그날 미국 시장 트레이딩
  // Example: 1/7 한국 데이터 → 1/7 EST 시장 트레이딩
  //          1/8 한국 데이터 → 1/8 EST 시장 트레이딩
  //          ... 1/11까지
  let targetDate;
  if (REPLAY_TARGET_DATE) {
    // Parse target date from environment variable (format: YYYY-MM-DD)
    const [year, month, day] = REPLAY_TARGET_DATE.split('-').map(Number);
    targetDate = new Date(year, month - 1, day);
    console.log(`📅 Using target date from REPLAY_TARGET_DATE: ${REPLAY_TARGET_DATE}`);
  } else {
    targetDate = new Date();
  }
  const kstToday = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  
  const targetYear = kstToday.getFullYear();
  const targetMonth = kstToday.getMonth();
  const targetDay = kstToday.getDate();
  
  const sensorData = allSensorData
    .filter(d => {
      // Convert timestamp to KST date for proper filtering
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      // Use today's KST data
      return kstDate.getFullYear() === targetYear && 
             kstDate.getMonth() === targetMonth && 
             kstDate.getDate() === targetDay;
    })
    .sort((a, b) => a.tsMs - b.tsMs);
  
  trades.sort((a, b) => (a.tsMs || 0) - (b.tsMs || 0));

  console.log(`📊 Loaded ${sensorData.length} sensor readings for ${targetYear}-${targetMonth+1}-${targetDay} and ${trades.length} trades`);
  
  if (sensorData.length === 0) {
    console.warn(`⚠️ No data found for ${targetYear}-${targetMonth+1}-${targetDay}`);
  }

  // Send all trades at once to new connections
  if (trades.length > 0) {
    io.emit('replayTrades', { trades });
  }

  // Store sensor data for lookup by time
  // Key: "YYYY-MM-DD-HH-MM" (KST time), Value: sensor data
  // 오늘 KST 데이터를 KST 시간으로 인덱싱
  const sensorDataByTime = new Map();
  for (const sensor of sensorData) {
    const date = new Date(sensor.tsMs);
    const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const timeKey = `${kstDate.getFullYear()}-${String(kstDate.getMonth() + 1).padStart(2, '0')}-${String(kstDate.getDate()).padStart(2, '0')}-${String(kstDate.getHours()).padStart(2, '0')}-${String(kstDate.getMinutes()).padStart(2, '0')}`;
    sensorDataByTime.set(timeKey, sensor);
  }
  
  // Indexed sensor data for quick lookup
  
  // Store sensorDataByTime globally so logCurrentTickerState can access it
  global.sensorDataByTime = sensorDataByTime;

  // Function to find and use KST data matching current EST time
  async function processCurrentTimeTrading() {
    if (!REPLAY_TRADE) return;
    
    // Get current EST time
    const now = new Date();
    const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const estYear = estNow.getFullYear();
    const estMonth = estNow.getMonth();
    const estDay = estNow.getDate();
    const estHour = estNow.getHours();
    const estMinute = estNow.getMinutes();
    
    // Check if we should start trading (if REPLAY_START_TIME is set)
    if (REPLAY_START_TIME) {
      const [startHour, startMinute] = REPLAY_START_TIME.split(':').map(Number);
      const currentTimeMinutes = estHour * 60 + estMinute;
      const startTimeMinutes = startHour * 60 + startMinute;
      
      // Check if we're on the target date
      const isTargetDate = estYear === targetYear && estMonth === targetMonth && estDay === targetDay;
      
      if (!isTargetDate || currentTimeMinutes < startTimeMinutes) {
        // Not yet time to start trading
        if (estMinute % 5 === 0) { // Log every 5 minutes
          console.log(`⏳ Waiting for trading start time: ${REPLAY_TARGET_DATE || 'today'} EST ${REPLAY_START_TIME} (current: ${estYear}-${String(estMonth+1).padStart(2,'0')}-${String(estDay).padStart(2,'0')} ${String(estHour).padStart(2,'0')}:${String(estMinute).padStart(2,'0')})`);
        }
        return;
      }
    }
    
    // Find target date's KST data with same time (hour:minute) as current EST time
    // 타겟 날짜 KST 데이터를 찾았으므로, EST 시간(시:분)과 같은 KST 시간(시:분)의 데이터 사용
    // Example: EST 1/8 9:30 → KST 1/8 9:30 데이터 사용
    const timeKey = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}-${String(estHour).padStart(2, '0')}-${String(estMinute).padStart(2, '0')}`;
    const sensor = sensorDataByTime.get(timeKey);
    
    if (sensor && isMarketHours()) {
      // Found matching KST data for current EST time
      const kstDate = new Date(sensor.tsMs);
      const kst = new Date(kstDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      
      // Format and update lastReading for display
      const formatted = {
        time: sensor.tsLocal || new Date(sensor.tsMs).toLocaleString(LOCALE, { timeZone: TIME_ZONE }),
        date: new Date(sensor.tsMs).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }),
        timeStamp: now.getTime(), // Use current time
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

      // Use KST sensor data for trading
      const sensorDataForTrading = {
        timeStamp: now.getTime(), // Use current time for trading
        lux: sensor.lux,
        temperature: sensor.temperature,
        humidity: sensor.humidity,
        current: sensor.current,
        power: sensor.power,
        battery: sensor.battery
      };
      
      // Only log when trading actually happens or every 5 minutes
      const shouldLog = powerPositiveCount >= 5 || estMinute % 5 === 0;
      if (shouldLog) {
        console.log(`🔄 한국 기상 데이터로 미국 시장 트레이딩: KST ${kst.getFullYear()}-${kst.getMonth()+1}-${kst.getDate()} ${String(kst.getHours()).padStart(2,'0')}:${String(kst.getMinutes()).padStart(2,'0')} → EST ${estYear}-${estMonth+1}-${estDay} ${String(estHour).padStart(2,'0')}:${String(estMinute).padStart(2,'0')}`);
        console.log(`   Sensor: Lux=${sensor.lux}, Temp=${sensor.temperature}, Power=${sensor.power}, powerPositiveCount: ${powerPositiveCount}`);
      }
      
      try {
        await handleSensorData(sensorDataForTrading, true);
      } catch (err) {
        console.error('❌ Error processing trading data:', err.message);
        console.error('Stack:', err.stack);
      }
    }
  }

  // Check every minute for current time matching
  setInterval(processCurrentTimeTrading, 60000); // Check every minute
  // Also check immediately
  processCurrentTimeTrading();
}

// Replay mode is now started after Google Sheets initialization (see initSheets above)
// Only start here if Sheets is disabled (which shouldn't happen for replay mode)
if (REPLAY_MODE && !SHEETS_ENABLED) {
  console.error('❌ Replay mode requires Google Sheets');
}

app.use(express.static('public'));

// Helper function to collect current ticker context and log to BLE Display sheet
async function logCurrentTickerState(messageTypeOverride = null, exitData = null) {
  if (!SHEETS_ENABLED) return;

  try {
    const toNum = v => (typeof v === 'number' ? v : (Number(v) || 0));
    
    // Try to get current sensor data from replay mode first (현재 EST 시간에 맞는 오늘 KST 데이터)
    let sensor = null;
    if (REPLAY_MODE && global.sensorDataByTime) {
      const now = new Date();
      const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const kstToday = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const estHour = estNow.getHours();
      const estMinute = estNow.getMinutes();
      // Use today's KST date with EST time (hour:minute)
      const timeKey = `${kstToday.getFullYear()}-${String(kstToday.getMonth() + 1).padStart(2, '0')}-${String(kstToday.getDate()).padStart(2, '0')}-${String(estHour).padStart(2, '0')}-${String(estMinute).padStart(2, '0')}`;
      const currentSensor = global.sensorDataByTime.get(timeKey);
      if (currentSensor) {
        sensor = {
          lux: toNum(currentSensor.lux),
          temperature: toNum(currentSensor.temperature),
          humidity: toNum(currentSensor.humidity),
          current: toNum(currentSensor.current),
          power: toNum(currentSensor.power)
        };
      } else {
        // If exact minute not found, try to find closest data (within same hour)
        const hourKey = `${kstToday.getFullYear()}-${String(kstToday.getMonth() + 1).padStart(2, '0')}-${String(kstToday.getDate()).padStart(2, '0')}-${String(estHour).padStart(2, '0')}`;
        for (let m = estMinute; m >= 0; m--) {
          const tryKey = `${hourKey}-${String(m).padStart(2, '0')}`;
          const trySensor = global.sensorDataByTime.get(tryKey);
          if (trySensor) {
            sensor = {
              lux: toNum(trySensor.lux),
              temperature: toNum(trySensor.temperature),
              humidity: toNum(trySensor.humidity),
              current: toNum(trySensor.current),
              power: toNum(trySensor.power)
            };
            break;
          }
        }
      }
    }
    
    // Fallback to lastReading if available
    if (!sensor && lastReading) {
      sensor = {
        lux: toNum(lastReading.lux),
        temperature: toNum(lastReading.temperature),
        humidity: toNum(lastReading.humidity),
        current: toNum(lastReading.current),
        power: toNum(lastReading.power)
      };
    }
    
    // Default to zeros if no data available
    if (!sensor) {
      sensor = { lux: 0, temperature: 0, humidity: 0, current: 0, power: 0 };
    }
    
    const mood = tradeMood;
    const suggestedStocks = moodStockMap[tradeMood] || [];
    const rp = getRiskProfile(sensor.lux);
    const hold = getMaxHoldMinutes(sensor.humidity);
    const risk = { takeProfitPct: rp.takeProfit, stopLossPct: rp.stopLoss, holdMinutes: hold };
    
    // Fetch account info
    let account = null;
    try {
      const acct = await alpaca.getAccountInfo();
      if (acct && (acct.cash != null)) {
        account = { cash: acct.cash };
      }
    } catch (err) {
      // continue without account
    }
    
    // Get position info - include ALL open positions for better tracking
    let position = null;
    let order = null; // Track most recent order
    let allPositions = []; // Track ALL open positions
    if (tradeManager && tradeManager.openTrades && tradeManager.openTrades.length > 0) {
      // Get ALL open trades, sorted by entry time (most recent first)
      const sortedTrades = [...tradeManager.openTrades].sort((a, b) => (b.entryTime || 0) - (a.entryTime || 0));
      const t = sortedTrades[0]; // Most recent for single position display
      let tpPct, slPct;
      if (t.side === 'long') {
        tpPct = ((t.tpPrice / t.entryPrice) - 1) * 100;
        slPct = (1 - (t.slPrice / t.entryPrice)) * 100;
      } else {
        tpPct = (1 - (t.tpPrice / t.entryPrice)) * 100;
        slPct = ((t.slPrice / t.entryPrice) - 1) * 100;
      }
      const nowMs = Date.now();
      const elapsedMin = t.entryTime ? (nowMs - t.entryTime) / 60000 : 0;
      const holdLeft = Math.max(0, (t.maxHoldMinutes || hold) - elapsedMin);
      
      // Calculate P/L
      let pnlPct = null;
      try {
        const pos = await alpaca.getPosition(t.symbol);
        if (pos && pos.market_value && pos.qty) {
          const currentPrice = pos.market_value / pos.qty;
          if (t.side === 'long') {
            pnlPct = ((currentPrice / t.entryPrice) - 1) * 100;
          } else {
            pnlPct = (1 - (currentPrice / t.entryPrice)) * 100;
          }
        }
      } catch (err) {
        // Position might not exist yet
      }
      
      position = {
        symbol: t.symbol,
        side: t.side,
        entryPrice: t.entryPrice,
        size: t.shares,
        entryTime: t.entryTime,
        maxHoldMinutes: t.maxHoldMinutes || hold,
        tpPct,
        slPct,
        pnlPct,
        holdMinutesLeft: holdLeft
      };
      
      // Also create order object for ORDER message type (if trade was just executed)
      // Check if trade was executed within last 2 minutes
      if (t.entryTime && (nowMs - t.entryTime) < 120000) {
        order = {
          symbol: t.symbol,
          side: t.side,
          size: t.shares,
          entryPrice: t.entryPrice,
          entryTime: t.entryTime,
          maxHoldMinutes: t.maxHoldMinutes || hold,
          holdMinutesLeft: holdLeft
        };
      }
    }
    
    // If no position but we have order data, use it for ORDER type
    if (!position && order) {
      position = {
        symbol: order.symbol,
        side: order.side,
        entryPrice: order.entryPrice,
        size: order.size,
        entryTime: order.entryTime,
        maxHoldMinutes: order.maxHoldMinutes,
        holdMinutesLeft: order.holdMinutesLeft
      };
    }
    
    // Market status (트레이딩 관련은 모두 미국 시간 기준)
    const hasActivePosition = !!(tradeManager && tradeManager.openTrades && tradeManager.openTrades.length > 0);
    const inferredOpen = marketOpen || isMarketHours() || hasActivePosition;
    
    // Calculate next open time in EST (미국 시간 기준)
    let nextOpenMinutes = null;
    if (!inferredOpen) {
      const now = new Date();
      const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const nextOpen = new Date(est);
      nextOpen.setHours(9, 30, 0, 0);
      if (nextOpen <= est) {
        nextOpen.setDate(nextOpen.getDate() + 1);
      }
      // Skip weekends
      while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 1);
      }
      nextOpenMinutes = (nextOpen - est) / 60000;
    }
    
    const market = { 
      open: inferredOpen,
      nextOpenMinutes: nextOpenMinutes, // 미국 시간 기준 (EST)
      cooldownMinutesLeft: lastMarketCloseTime > 0 
        ? Math.max(0, MARKET_COOLDOWN_MINUTES - ((Date.now() - lastMarketCloseTime) / 60000))
        : 0
    };
    
    const context = { 
      sensor, 
      mood, 
      suggestedStocks, 
      risk, 
      order, // Include order for ORDER message type
      position, 
      exit: exitData,
      market, 
      account,
      nowMs: Date.now()
    };
    
    const messages = createTickerMessages(context);
    if (messages.length === 0) return;
    
    // Determine message type - prioritize ORDER if trade was just executed
    let messageType = messageTypeOverride;
    if (!messageType) {
      if (exitData) {
        messageType = 'EXIT';
      } else if (order && order.symbol && order.entryTime && (Date.now() - order.entryTime) < 120000) {
        // If order was executed within last 2 minutes, show ORDER type
        messageType = 'ORDER';
      } else if (position && position.symbol) {
        messageType = 'POSITION';
      } else if (market.open === false) {
        messageType = 'MARKET_CLOSED';
      } else {
        messageType = 'DECISION';
      }
    }
    
    // For ORDER type, we need to log TWO messages: weather data (1차) and order info (2차)
    if (messageType === 'ORDER' && messages.length >= 2) {
      // 1차: 기상 데이터 메시지
      const weatherMessage = messages[0];
      const [weatherLine1, weatherLine2] = weatherMessage.split('\n');
      
      // 2차: ORDER 정보 메시지
      const orderMessage = messages[1];
      const [orderLine1, orderLine2] = orderMessage.split('\n');
      
      // Log 1차: 기상 데이터
      const weatherLogData = {
        timestamp: new Date().toISOString(),
        message_type: 'ORDER_WEATHER', // 1차 메시지 표시
        line1: weatherLine1 || '',
        line2: weatherLine2 || '',
        final_display_text: weatherMessage,
        lux: sensor.lux,
        temperature: sensor.temperature,
        humidity: sensor.humidity,
        current: sensor.current,
        power: sensor.power,
        mood: mood || '',
        suggested_stock_1: suggestedStocks[0] || '',
        suggested_stock_2: suggestedStocks[1] || '',
        risk_take_profit_pct: risk.takeProfitPct,
        risk_stop_loss_pct: risk.stopLossPct,
        risk_hold_minutes: risk.holdMinutes,
        account_cash: account?.cash || null,
        order_side: order?.side ? (order.side === 'long' ? 'BUY' : 'SELL') : '',
        order_symbol: order?.symbol || '',
        order_size: order?.size || null,
        entry_price: order?.entryPrice || null,
        hold_minutes_left: order?.holdMinutesLeft || null
      };
      
      await logBLEDisplay(weatherLogData);
      console.log(`📊 Logged BLE Display: ORDER_WEATHER (1차) - Lux=${sensor.lux}, Temp=${sensor.temperature}, Power=${sensor.power}`);
      
      // Log 2차: ORDER 정보
      const orderLogData = {
        timestamp: new Date().toISOString(),
        message_type: 'ORDER', // 2차 메시지
        line1: orderLine1 || '',
        line2: orderLine2 || '',
        final_display_text: orderMessage,
        lux: sensor.lux,
        temperature: sensor.temperature,
        humidity: sensor.humidity,
        current: sensor.current,
        power: sensor.power,
        mood: mood || '',
        suggested_stock_1: suggestedStocks[0] || '',
        suggested_stock_2: suggestedStocks[1] || '',
        risk_take_profit_pct: risk.takeProfitPct,
        risk_stop_loss_pct: risk.stopLossPct,
        risk_hold_minutes: risk.holdMinutes,
        account_cash: account?.cash || null,
        order_side: order?.side ? (order.side === 'long' ? 'BUY' : 'SELL') : '',
        order_symbol: order?.symbol || '',
        order_size: order?.size || null,
        entry_price: order?.entryPrice || null,
        hold_minutes_left: order?.holdMinutesLeft || null
      };
      
      await logBLEDisplay(orderLogData);
      console.log(`📊 Logged BLE Display: ORDER (2차) - ${order?.symbol} ${order?.side} @ ${order?.entryPrice}`);
      return; // Early return for ORDER type
    }
    
    // For other message types, use first message (primary display)
    const primaryMessage = messages[0];
    const [line1, line2] = primaryMessage.split('\n');
    
    // Build data object for logging
    const logData = {
      timestamp: new Date().toISOString(),
      message_type: messageType,
      line1: line1 || '',
      line2: line2 || '',
      final_display_text: primaryMessage,
      // Sensor data
      lux: sensor.lux,
      temperature: sensor.temperature,
      humidity: sensor.humidity,
      current: sensor.current,
      power: sensor.power,
      // Mood and stocks
      mood: mood || '',
      suggested_stock_1: suggestedStocks[0] || '',
      suggested_stock_2: suggestedStocks[1] || '',
      // Risk parameters
      risk_take_profit_pct: risk.takeProfitPct,
      risk_stop_loss_pct: risk.stopLossPct,
      risk_hold_minutes: risk.holdMinutes,
      // Account
      account_cash: account?.cash || null,
      // Order information (when ORDER type)
      order_side: (messageType === 'ORDER' && order?.side) ? (order.side === 'long' ? 'BUY' : 'SELL') : (position?.side ? (position.side === 'long' ? 'BUY' : 'SELL') : ''),
      order_symbol: (messageType === 'ORDER' && order?.symbol) ? order.symbol : (position?.symbol || ''),
      order_size: (messageType === 'ORDER' && order?.size) ? order.size : (position?.size || null),
      // Position data (when POSITION type)
      position_symbol: (messageType === 'POSITION' && position?.symbol) ? position.symbol : '',
      position_side: (messageType === 'POSITION' && position?.side) ? (position.side === 'long' ? 'BUY' : 'SELL') : '',
      entry_price: (messageType === 'POSITION' && position?.entryPrice) ? position.entryPrice : ((messageType === 'ORDER' && order?.entryPrice) ? order.entryPrice : null),
      pnl_pct: (messageType === 'POSITION' && position?.pnlPct != null) ? position.pnlPct : null,
      pnl_direction: (messageType === 'POSITION' && position?.pnlPct != null)
        ? (position.pnlPct > 0 ? '▲' : position.pnlPct < 0 ? '▼' : '•')
        : '',
      position_stop_loss_pct: (messageType === 'POSITION' && position?.slPct) ? position.slPct : null,
      position_take_profit_pct: (messageType === 'POSITION' && position?.tpPct) ? position.tpPct : null,
      position_size: (messageType === 'POSITION' && position?.size) ? position.size : null,
      hold_minutes_left: (messageType === 'POSITION' && position?.holdMinutesLeft != null) ? position.holdMinutesLeft : ((messageType === 'ORDER' && order?.holdMinutesLeft != null) ? order.holdMinutesLeft : null),
      equity: account?.equity || null,
      // Exit data
      exit_symbol: exitData?.symbol || '',
      exit_side: exitData?.side ? (exitData.side === 'long' ? 'BUY' : 'SELL') : '',
      exit_price: exitData?.exitPrice || null,
      exit_direction: exitData?.exitPrice && exitData?.entryPrice
        ? (exitData.exitPrice > exitData.entryPrice ? '▲' : exitData.exitPrice < exitData.entryPrice ? '▼' : '•')
        : '',
      exit_reason: exitData?.reason || '',
      exit_pnl_pct: exitData?.pnlPct || null,
      held_minutes: exitData?.heldMinutes || null,
      // Market data
      next_open_hours: market.nextOpenMinutes != null ? Math.floor(market.nextOpenMinutes / 60) : null,
      next_open_minutes: market.nextOpenMinutes != null ? market.nextOpenMinutes % 60 : null,
      cooldown_minutes_left: market.cooldownMinutesLeft || null
    };
    
    await logBLEDisplay(logData);
    // Only log if sensor data is valid (not all zeros)
    if (sensor.lux > 0 || sensor.power > 0) {
      console.log(`📊 Logged BLE Display: ${messageType} - Lux=${sensor.lux}, Temp=${sensor.temperature}, Power=${sensor.power}`);
    }
    
    // If there are multiple positions, log each one separately
    if (allPositions && allPositions.length > 1 && messageType === 'POSITION') {
      // Log additional positions (skip first one as it's already logged above)
      for (let i = 1; i < allPositions.length; i++) {
        const pos = allPositions[i];
        const posContext = {
          sensor,
          mood,
          suggestedStocks,
          risk,
          order: null,
          position: pos,
          exit: null,
          market,
          account,
          nowMs: Date.now()
        };
        const posMessages = createTickerMessages(posContext);
        if (posMessages.length > 0) {
          const posMessage = posMessages[0];
          const [posLine1, posLine2] = posMessage.split('\n');
          
          const posLogData = {
            timestamp: new Date().toISOString(),
            message_type: 'POSITION',
            line1: posLine1 || '',
            line2: posLine2 || '',
            final_display_text: posMessage,
            lux: sensor.lux,
            temperature: sensor.temperature,
            humidity: sensor.humidity,
            current: sensor.current,
            power: sensor.power,
            mood: mood || '',
            suggested_stock_1: suggestedStocks[0] || '',
            suggested_stock_2: suggestedStocks[1] || '',
            risk_take_profit_pct: risk.takeProfitPct,
            risk_stop_loss_pct: risk.stopLossPct,
            risk_hold_minutes: risk.holdMinutes,
            account_cash: account?.cash || null,
            position_symbol: pos.symbol || '',
            position_side: pos.side ? (pos.side === 'long' ? 'LONG' : 'SHORT') : '',
            entry_price: pos.entryPrice || null,
            pnl_pct: pos.pnlPct || null,
            pnl_direction: pos.pnlPct != null
              ? (pos.pnlPct > 0 ? '▲' : pos.pnlPct < 0 ? '▼' : '•')
              : '',
            position_stop_loss_pct: pos.slPct || null,
            position_take_profit_pct: pos.tpPct || null,
            position_size: pos.size || null,
            hold_minutes_left: pos.holdMinutesLeft || null,
            equity: account?.equity || null
          };
          
          await logBLEDisplay(posLogData);
          console.log(`📊 Logged BLE Display: POSITION (${pos.symbol}) - Lux=${sensor.lux}, Temp=${sensor.temperature}, Power=${sensor.power}`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error logging BLE Display state:', error.message);
  }
}

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