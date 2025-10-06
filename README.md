This is a web server for Audrey DOh's project "Day Trader,"  A short-term, automatic investment system powered by the sun data, where investments are made according to interpretations of solar data. 

   ☀ ESP32 (Solar-panel powered sensor station)
            ↓
   ☀ MQTT Broker
            ↓
☀ Render.com 24/7 Web Server (Node.js + Express)
├── Subscribes to MQTT topic
├── Displays data on dashboard
├── Calls Alpaca API (via Axios) to make trades
└── Displays trading data on Ticker Tape LED Matrix Panel

            ↓
  ☀ Alpaca Trading Account (Paper)
