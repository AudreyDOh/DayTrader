require('dotenv').config(); // Load .env variables

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

// State: last reading and history
let lastReading = null;
const sensorHistory = [];

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

// Classify weather mood
function classifyWeatherMood({ lux, temperature, humidity }) {
  const brightness = lux > 10000 ? 'High' : 'Low';
  const temp = temperature > 22 ? 'High' : 'Low';
  const humid = humidity > 50 ? 'High' : 'Low';

  if (brightness === 'High' && temp === 'High' && humid === 'Low') return 'Blazing';
  if (brightness === 'High' && temp === 'Low' && humid === 'Low') return 'Crisp';
  if (brightness === 'High' && temp === 'High' && humid === 'High') return 'Obsessive';
  if (brightness === 'High' && temp === 'Low' && humid === 'High') return 'Mixed';
  if (brightness === 'Low' && temp === 'High' && humid === 'High') return 'Heavy';
  if (brightness === 'Low' && temp === 'Low' && humid === 'High') return 'Depressed';
  if (brightness === 'Low' && temp === 'Low' && humid === 'Low') return 'Minimal';
  if (brightness === 'Low' && temp === 'High' && humid === 'Low') return 'Eerie';

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
      if (data.power > 0 && today !== currentDay) {
        dailyMood = classifyWeatherMood(data);
        currentDay = today;
        console.log(`📅 New day: ${today}, Mood: ${dailyMood}`);
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
  if (lastReading) {
    socket.emit('mqttData', {
      latest: lastReading,
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
