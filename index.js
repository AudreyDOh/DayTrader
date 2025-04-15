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

// MQTT connect and subscribe
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  mqttClient.subscribe(topic);
});

// Handle MQTT messages
mqttClient.on('message', (topic, message) => {
  const msg = message.toString();

  try {
    const data = JSON.parse(msg);

    // Only process if it looks like real sensor data
    if ('lux' in data || 'temperature' in data || 'humidity' in data || 'power' in data || 'current' in data || 'battery' in data) {
      const formatted = {
        time: new Date().toLocaleString(),
        temperature: data.temperature ?? '—',
        humidity: data.humidity ?? '—',
        lux: data.lux ?? '—',
        current: data.current ?? '—',
        power: data.power ?? '—',
        battery: data.battery ?? '—'
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
      console.log('Ignored non-sensor message:', msg);
    }
  } catch (err) {
    console.log('Invalid JSON:', msg);
  }
});

// When a browser connects, send the latest data
io.on('connection', socket => {
  console.log('New client connected');
  if (lastReading) {
    socket.emit('mqttData', {
      latest: lastReading,
      history: sensorHistory
    });
  }
});

// Serve static files (dashboard)
app.use(express.static('public'));

// Start the server
server.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
