require('dotenv').config(); // storing private keys in .env file 

/**** Importing libraries ****/
const mqtt = require('mqtt'); // MQTT connection to MQTT broker
const express = require('express'); // create basic web server
const http = require('http'); // connect web server to socket.io
const socketIo = require('socket.io'); // send real-time data to browser
const axios = require('axios'); // talk to API

/**** Create server + real-time connection ****/
const app = express(); // creating express app (object) to handle web server
const server = http.createServer(app); // creating http server
const io = socketIo(server); // creating socket.io server for real time comms

/**** Store Sensor Data */
const sensorHistory = [];


// Connect to MQTT 
const mqttClient = mqtt.connect('mqtt://tigoe.net', {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
});
const topic = 'energy/audrey';//

// Subscribe to MQTT topic 
mqttClient.on('connect', () => { // 'connect' event
    console.log('Connected to MQTT broker');
    mqttClient.subscribe(topic);
});

// Listen for messages on the subscribed topic
mqttClient.on('message', (topic, message) => {
    const msg = message.toString();
  
    try {
      const data = JSON.parse(msg);
  
      // Only process sensor data (ignore boot/status messages)
      if ('lux' in data || 'temperature' in data || 'power' in data) { //check if the message contains sensor data
        // Format the data for display, using '—' for missing values
        const formatted = {
          time: new Date().toLocaleString(),
          temperature: data.temperature ?? '—',
          humidity: data.humidity ?? '—',
          lux: data.lux ?? '—',
          current: data.current ?? '—',
          power: data.power ?? '—',
          battery: data.battery ?? '—'
        };
  
        console.log('Sensor reading:', formatted); // log the sensor reading
  
        sensorHistory.unshift(formatted);
        if (sensorHistory.length > 5) sensorHistory.pop(); // keep only the last 5 readings
  
        // Emit the data to the client
        io.emit('mqttData', { 
          latest: formatted, // latest reading formatted for each sensor reading varialbe
          history: sensorHistory // last 5 reading history with timestamp
        });
      } else {
        console.log('Ignored non-sensor message:', msg);
      }
    } catch (err) {
      console.log('Invalid JSON:', msg);
    }
  });
  
// Serve dashboard files from the public folder
app.use(express.static('public')); // accessible directly from the browser

// Start the server
server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
})

