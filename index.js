require('dotenv').config(); // Load .env variables

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

// (2) ===== VARIABLES FOR MQTT Sensor Data =====

// State: last reading and history
const ENERGY_DATA_URL = 'https://tigoe.net/energy-data.json';
let lastReading = null;
const sensorHistory = [];

// (3) ===== VARIABLES FOR TRADING =====

// Daily Mood for what stocks to buy
const moodStockMap = {
  "Bright & Dry": ["TSLA", "NVDA", "META"],      // momentum, high-beta
  "Dark & Wet": ["SPY", "JNJ", "PG"],            // stable, dividend
  "Cold & Bright": ["AMD", "PLTR", "UBER"],      // mid-cap growth
  "Hot & Humid": ["GME", "MARA", "COIN"],        // meme, speculative
  "Cold & Wet": ["TLT", "XLU", "GLD"],           // defensive
  "Hot & Dry": ["AI", "UPST", "HOOD"],           // volatile, gappers
};

const sampleSensorData = {
  lux: 52000,
  temperature: 30,
  humidity: 32
};

const mood = determineMood(sampleSensorData);
const stockOptions = moodStockMap[mood] || [];

console.log("Weather mood:", mood);
console.log("Suggested stocks:", stockOptions);



//                      * * * * * * * * * * * * * * * * * * * * * * * * 



//===== EVERYTHING TRADING RELATED =====

// Determine what stocks to buy/sell based on the mood at start of day
function determineMood({ lux, temperature, humidity }) {
  const isBright = lux > 40000;
  const isDark = lux < 10000;
  const isHot = temperature > 28;
  const isCold = temperature < 15;
  const isDry = humidity < 40;
  const isWet = humidity > 65;

  if (isBright && isDry && isHot) return "Hot & Dry";
  if (isBright && isDry && isCold) return "Cold & Bright";
  if (isDark && isWet && isCold) return "Cold & Wet";
  if (isDark && isWet && isHot) return "Hot & Humid";
  if (isBright && isWet && isCold) return "Bright & Wet"; // optional
  if (isDark && isDry) return "Dry & Cloudy"; // optional
  if (isBright && isDry) return "Bright & Dry";
  if (isDark && isWet) return "Dark & Wet";

  return "Unknown";
}














// ======= EVERYTHING SENSOR RELATED =======
// ===== Fetch Historical Data from MQTT =====
axios.get(ENERGY_DATA_URL, { responseType: 'text' })
  .then(response => {
    const lines = response.data.trim().split('\n');
    const parsed = lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      })
      .filter(entry => entry && entry.creator === 'audrey' && entry.lux !== undefined);

      const formattedData = parsed.map(entry => ({
        timeStamp: entry.timeStamp, // for sorting
        time: new Date(entry.timeStamp).toLocaleString('en-US', {
          timeZone: 'America/New_York'
        }),
        temperature: entry.temperature ?? '—',
        humidity: entry.humidity ?? '—',
        lux: entry.lux ?? '—',
        current: entry.current ?? '—',
        power: entry.power ?? '—',
        battery: entry.battery ?? '—',
        mood: 'Unknown'
      }));
      
      // Sort by timestamp descending (most recent first)
      formattedData.sort((a, b) => new Date(b.timeStamp) - new Date(a.timeStamp));
      
      // Save the 5 most recent
      sensorHistory.push(...formattedData.slice(0, 5));
      

    console.log(`📥 Loaded ${sensorHistory.length} Audrey entries from history.`);
  })
  .catch(err => {
    console.error('❌ Failed to fetch Audrey data history:', err.message);
  });


let currentDay = null;
let dailyMood = null;

// ===== Utilities =====

// Convert to YYYY-MM-DD in New York time
function getTodayDateString() {
  const estDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const [month, day, year] = estDate.split('/');
  return `${year}-${month}-${day}`;
}

// Classify weather mood based on brightness, temperature, and humidity
function classifyWeatherMood({ lux, temperature, humidity }) {
  const brightness = lux > 10000 ? 'High' : 'Low';
  const temp = temperature > 22 ? 'High' : 'Low';
  const humid = humidity > 50 ? 'High' : 'Low';

  if (brightness === 'High' && temp === 'High' && humid === 'Low') return 'Sunny Bold';
  if (brightness === 'High' && temp === 'Low' && humid === 'Low') return 'Cool Clear';
  if (brightness === 'High' && temp === 'High' && humid === 'High') return 'Hot & Sticky';
  if (brightness === 'High' && temp === 'Low' && humid === 'High') return 'Bright & Damp';
  if (brightness === 'Low' && temp === 'High' && humid === 'High') return 'Humid Haze';
  if (brightness === 'Low' && temp === 'Low' && humid === 'High') return 'Foggy Chill';
  if (brightness === 'Low' && temp === 'Low' && humid === 'Low') return 'Dry Shade';
  if (brightness === 'Low' && temp === 'High' && humid === 'Low') return 'Warm Gloom';

  return 'Unknown';
}


// ===== MQTT Connect =====

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe(topic);
});

// ===== Handle Incoming MQTT Messages =====

mqttClient.on('message', (topic, message) => {
  const msg = message.toString();

  try {
    const data = JSON.parse(msg);

    if ('lux' in data || 'temperature' in data || 'humidity' in data || 'power' in data || 'current' in data || 'battery' in data) {
      const today = getTodayDateString();

      // Set daily mood once per day at first valid solar reading
      if (data.power > 0) {
        {
      
        const tradeMood = determineMood(data); 
const suggestedStocks = moodStockMap[tradeMood] || [];

console.log(`🪐 Trade Mood: ${tradeMood}`);
console.log(`📈 Suggested Stocks:`, suggestedStocks);

        dailyMood = classifyWeatherMood(data);
        currentDay = today;
        console.log(`📅 New day: ${today}, Mood: ${dailyMood}`);
        // Emit the mood to the frontend: emit means sending data to frontend
        io.emit('weatherMood', {
          mood: dailyMood
        });
        // Emit the suggested stocks to the frontend
        io.emit('suggestedStocks', {
          stocks: suggestedStocks
        });
      }

      // Convert UTC timestamp to EST or use current time
      const estTime = new Date(data.timeStamp ?? Date.now()).toLocaleString('en-US', {
        timeZone: 'America/New_York'
      });

      const formatted = {
        time: estTime,
        temperature: data.temperature ?? '—',
        humidity: data.humidity ?? '—',
        lux: data.lux ?? '—',
        current: data.current ?? '—',
        power: data.power ?? '—',
        battery: data.battery ?? '—',
        mood: dailyMood ?? 'Not Set'
      };

      console.log('Sensor reading:', formatted);


      lastReading = formatted;
      sensorHistory.unshift(formatted);
      if (sensorHistory.length > 5) sensorHistory.pop();

      io.emit('mqttData', {
        latest: lastReading,
        history: sensorHistory
      });
    } else {
      console.log('⚠️ Ignored non-sensor message:', msg);
    }
  } catch (err) {
    console.log('❌ Invalid JSON:', msg);
  }
});

// ===== Frontend Connection =====

io.on('connection', socket => {
  console.log('🔌 New frontend connected');
  if (lastReading || sensorHistory.length > 0) {
    socket.emit('mqttData', {
      latest: lastReading ?? sensorHistory[0],
      history: sensorHistory
    });
  }
});

// ===== Serve Static Frontend =====

app.use(express.static('public'));

// ===== Start Server =====

server.listen(3000, () => {
  console.log('🌐 Server running at http://localhost:3000');
});
