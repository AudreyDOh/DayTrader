/* 
Received data from MQTT Broker and forwards data via Websocket to Frontend 
*/

require('dotenv').config();
const { authorizeGoogleSheets, logToSheet } = require('./logToSheets');
const TradeManager = require('./tradeManager');
const mqtt = require('mqtt');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const mqttClient = mqtt.connect('mqtt://tigoe.net', {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
});
const topic = 'energy/audrey';

authorizeGoogleSheets();

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

const moodStockMap = {
  "Bright & Dry": ["TSLA", "NVDA", "META", "SHOP", "AAPL", "MSFT", "AMZN", "GOOGL"],
  "Cold & Bright": ["PLTR", "UBER", "ABNB", "NET", "ROKU", "SNOW", "DKNG"],
  "Hot & Dry": ["AI", "UPST", "HOOD", "COIN", "AFRM", "SOFI", "LCID", "RIVN", "FSLY", "BB"],
  "Hot & Humid": ["GME", "MARA", "RIOT", "BBBY", "CVNA", "AMC", "OSTK", "SPCE", "BBIG", "DWAC"],
  "Dark & Wet": ["SPY", "JNJ", "PG", "KO", "PEP", "VZ", "WMT", "XLP", "XLU"],
  "Dry & Cloudy": ["TLT", "XLU", "GLD", "XLF", "XLE", "USO", "BND"],
  "Bright & Wet": ["DIS", "SQ", "SOFI", "PYPL", "ZM", "LYFT", "WISH"],
  "Cold & Wet": []
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

  return "Unknown";
}

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe(topic);
});

mqttClient.on('message', async (topic, message) => {
  const msg = message.toString();
  try {
    const data = JSON.parse(msg);
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
      io.emit('marketStatus', { open: true });

      tradeMood = determineTradeMood(data);
      const suggestedStocks = moodStockMap[tradeMood] || [];

      io.emit('weatherMood', { mood: moodNameMap[tradeMood] ?? tradeMood });
      io.emit('suggestedStocks', { stocks: suggestedStocks });

      if (tradeMood !== "Cold & Wet" && suggestedStocks.length > 0) {
        const equity = 100000; // Starting paper balance
        tradeManager = new TradeManager(equity);

        tradingInterval = setInterval(async () => {
          for (const symbol of suggestedStocks) {
            const result = await tradeManager.evaluateTradeEntry(
              symbol,
              tradeMood,
              data.lux,
              data.temperature,
              data.humidity
            );

            if (!result?.executed && result?.reason) {
              const timeNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
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
  if (lastReading || sensorHistory.length > 0) {
    socket.emit('mqttData', {
      latest: lastReading ?? sensorHistory[0],
      history: sensorHistory
    });
  }

  if (tradeMood) {
    socket.emit('weatherMood', { mood: moodNameMap[tradeMood] ?? tradeMood });
    socket.emit('suggestedStocks', { stocks: moodStockMap[tradeMood] || [] });
  }

  socket.emit('marketStatus', { open: marketOpen });
});

app.use(express.static('public'));

server.listen(3000, () => {
  console.log('🌐 Server running at http://localhost:3000');
});
