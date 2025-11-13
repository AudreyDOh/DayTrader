/* 
Received data from MQTT Broker and forwards data via Websocket to Frontend 
*/

require('dotenv').config();
const { authorizeGoogleSheets, logToSheet } = require('./logToSheets');
const { shouldSkipDay } = require('./solarStrategy');
const TradeManager = require('./tradeManager');
const mqtt = require('mqtt');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const alpaca = require('./alpaca'); // Alpaca Module to fetch account infos

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

// ADDED: Try-catch block around Google Sheets authorization
try {
  authorizeGoogleSheets();
} catch (err) {
  console.error('Error authorizing Google Sheets (continuing anyway):', err);
}

let lastReading = null;
const sensorHistory = [];
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

// Unified handler for incoming sensor data (MQTT or HTTP POST)
async function handleSensorData(data) {
  const now = Date.now();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

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
              const timeNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
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
    time: new Date(data.timeStamp ?? Date.now()).toLocaleString('en-US', {
      timeZone: 'America/New_York'
    }),
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
  if (sensorHistory.length > 5) sensorHistory.pop();

  io.emit('mqttData', {
    latest: lastReading,
    history: sensorHistory
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

    logToSheet(values);
  } catch (err) {
    console.error('Error logging to sheet:', err);
  }
}

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

// ADDED: Enhanced connection event handler with fallback data
io.on('connection', socket => {
  console.log('🔌 New client connected');

  if (lastReading || sensorHistory.length > 0) {
    socket.emit('mqttData', {
      latest: lastReading ?? sensorHistory[0],
      history: sensorHistory
    });
  } else {
    // ADDED: Provide fallback data if no real data is available
    console.log('No sensor data available, sending dummy data');
    const dummyData = {
      time: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
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

app.use(express.static('public'));

// Test route to check if API is working
app.get('/api/test', (req, res) => {
  // ADDED: More detailed test endpoint response
  const alpacaConfigured = !!(alpaca && alpaca.alpaca);
  
  res.json({
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    alpaca_configured: alpacaConfigured,
    env_vars_set: {
      ALPACA_API_KEY: !!process.env.ALPACA_API_KEY,
      ALPACA_SECRET_KEY: !!process.env.ALPACA_SECRET_KEY
    }
  });
});

// HTTP ingest endpoint for ESP32 to POST sensor readings (JSON)
app.post('/api/ingest', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
    }
    await handleSensorData(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ingest error:', err);
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