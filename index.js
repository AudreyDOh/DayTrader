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
const loggedSkips = new Set(); // ✅ Track skipped trades

const moodStockMap = {
  "Bright & Dry": ["TSLA", "NVDA", "META", "AVGO", "AAPL", "MSFT", "AMZN", "GOOGL"],
  "Cold & Bright": ["PLTR", "UBER", "ABNB", "SNOW", "ROKU", "DKNG", "DASH"],
  "Hot & Dry": ["COIN", "UPST", "HOOD", "AFRM", "SOFI", "LCID", "RIVN", "FSLY"],
  "Hot & Humid": ["GME", "MARA", "RIOT", "CVNA", "AMC", "OSTK", "SPCE", "DWAC"],
  "Dark & Wet": ["PG", "JNJ", "KO", "PEP", "WMT", "VZ", "MCK", "PM"],
  "Dry & Cloudy": ["PFE", "NKE", "EL", "CPB", "IFF", "BF.B", "STZ"],
  "Bright & Wet": ["CRM", "ADBE", "INTU", "ADSK", "PTC", "MANH", "NOW"],
  "Cold & Wet": []
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

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe(topic);
});

mqttClient.on('message', async (topic, message) => {
  const msg = message.toString();
  try {
    const data = JSON.parse(msg);
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
        // const equity = 100000; // Starting paper balance
        // tradeManager = new TradeManager(equity);
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
          // const equity = parseFloat(account.equity); // parseFloat to ensure full number without commas, save into "equity" variable
          // if (isNaN(equity)) {
          //   throw new Error('Invalid equity value from Alpaca');
          // }
          // console.log('📈 Alpaca account equity:', equity);
          // // tradeManager class 
          // tradeManager = new TradeManager(equity); // passes "equity" variable to TradeManager constructor 
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
            // /////////
            if (result?.executed) {
              console.log(`✅ TRADE EXECUTED: ${symbol}`);
            } else {
              console.log(`⏭️ Skipped ${symbol}: ${result?.reason}`);
            }
            ////////////

            if (!result?.executed && result?.reason) {
              const key = `${today}-${symbol}`;
              if (!loggedSkips.has(key)) {
                loggedSkips.add(key);
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
    // console.log('❌ Invalid JSON:', msg);
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
  //console.log('🌐 Server running at http://localhost:3000');
});
