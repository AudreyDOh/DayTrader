/* 
Received data from MQTT Broker and forwards data via Websocket to Frontend 
*/

require('dotenv').config(); // Load .env variables
const { authorizeGoogleSheets, logToSheet } = require('./logToSheets'); // Google Sheets integration for MQTT Data logging
const TradeManager = require('./tradeManager'); // TradeManager for executing trades
const Alpaca = require('@alpacahq/alpaca-trade-api'); // Alpaca API client

// (1) ===== VARIABLES FOR SETUP =====
const mqtt = require('mqtt');       // MQTT client
const express = require('express'); // Web server
const http = require('http');       // Needed for socket.io
const socketIo = require('socket.io'); // Real-time frontend updates
const axios = require('axios');     // For future Alpaca integration

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MQTT broker config
const mqttClient = mqtt.connect('mqtt://tigoe.net', {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
});
const topic = 'energy/audrey';

authorizeGoogleSheets(); // Authenticate once on startup

// (2) ===== VARIABLES FOR MQTT Sensor Data =====

const ENERGY_DATA_URL = 'https://tigoe.net/energy-data.json';
let lastReading = null;
const sensorHistory = [];
let currentDay = null;
let tradeMood = null;
let prevPower = 0;
let marketOpen = false;
let powerZeroCount = 0;
let powerPositiveCount = 0;
let tradeManager = null;
let lastMarketCloseTime = 0; // for cooldown tracking
const MARKET_COOLDOWN_MINUTES = 15;

// (3) ===== VARIABLES FOR TRADING =====

const moodStockMap = {
  "Bright & Dry": ["TSLA", "NVDA", "META"],
  "Dark & Wet": ["SPY", "JNJ", "PG"],
  "Cold & Bright": ["AMD", "PLTR", "UBER"],
  "Hot & Humid": ["GME", "MARA", "COIN"],
  "Cold & Wet": [],
  "Hot & Dry": ["AI", "UPST", "HOOD"],
  "Dry & Cloudy": ["TLT", "XLU", "GLD"],
  "Bright & Wet": ["DIS", "SQ", "SOFI"]
};

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

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true
});

function determineTradeMood({ lux, temperature, humidity }) {
  const isBright = lux > 1000;
  const isDark = lux <= 1000;
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

  return 'Unknown';
}

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe(topic);
});

mqttClient.on('message', async (topic, message) => {
  const msg = message.toString();
  try {
    const data = JSON.parse(msg);
    const today = getTodayDateString();
    const now = Date.now();

    if (data.power === 0) {
      powerZeroCount++;
      powerPositiveCount = 0;
    } else {
      powerZeroCount = 0;
      powerPositiveCount++;
    }

    const timeSinceLastClose = (now - lastMarketCloseTime) / 60000;

    if (powerPositiveCount >= 5 && !marketOpen && timeSinceLastClose >= MARKET_COOLDOWN_MINUTES) {
      marketOpen = true;
      tradeMood = determineTradeMood(data);
      const suggestedStocks = moodStockMap[tradeMood] || [];

      console.log('🧠 Trade Mood:', tradeMood);
      console.log('📈 Suggested Stocks:', suggestedStocks);

      if (tradeMood === "Cold & Wet" || suggestedStocks.length === 0) {
        console.log("⛔ Skipping trades due to mood or empty stock list.");
      } else {
        try {
          const account = await alpaca.getAccount();
          const equity = parseFloat(account.equity);
          tradeManager = new TradeManager(equity);
          for (const symbol of suggestedStocks) {
            await tradeManager.evaluateTradeEntry(
              symbol,
              tradeMood,
              data.lux,
              data.temperature,
              data.humidity
            );
          }
        } catch (err) {
          console.error('❌ Alpaca error:', err.message);
        }
      }
    }

    console.log('🔍 Power check — zeroCount:', powerZeroCount, 'marketOpen:', marketOpen);
   if (powerZeroCount >= 5 && marketOpen) {
  console.log('🌙 Power off sustained — force closing all trades.');
  marketOpen = false;
  powerZeroCount = 0;
  powerPositiveCount = 0;
  lastMarketCloseTime = now;
  if (tradeManager) {
    await tradeManager.forceCloseAll();
  }
}

    prevPower = data.power;
    currentDay = today;

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

    console.log('Sensor reading:', formatted);
    lastReading = formatted;
    sensorHistory.unshift(formatted);
    if (sensorHistory.length > 5) sensorHistory.pop();

    io.emit('mqttData', {
      latest: lastReading,
      history: sensorHistory
    });
    io.emit('weatherMood', { mood: formatted.mood });

 // ✅ this should always emit as long as tradeMood is set
if (tradeMood && moodStockMap[tradeMood]) {
  io.emit('suggestedStocks', { stocks: moodStockMap[tradeMood] });
}

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
    console.log('❌ Invalid JSON:', msg);
  }
});

io.on('connection', socket => {
  console.log('🔌 New frontend connected');
  if (lastReading || sensorHistory.length > 0) {
    socket.emit('mqttData', {
      latest: lastReading ?? sensorHistory[0],
      history: sensorHistory
    });
  }
  if (tradeMood) {
    socket.emit('weatherMood', { mood: moodNameMap[tradeMood] ?? tradeMood });
  }
  if (moodStockMap[tradeMood]) {
    socket.emit('suggestedStocks', { stocks: moodStockMap[tradeMood] });
  }
});

app.use(express.static('public'));

server.listen(3000, () => {
  console.log('🌐 Server running at http://localhost:3000');
});