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
mqttClient.on('message', (topic, message) => { // 'message' event
    const data = JSON.parse(message.toString()); // raw text to JSON
    console.log('Data received from MQTT:', data);
    io.emit('mqttData', data); // send data to browser
});

// Serve dashboard files from the public folder
app.use(express.static('public')); // accessible directly from the browser

// Start the server
server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
})

