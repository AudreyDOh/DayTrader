#!/usr/bin/env node
/**
 * Send BLE data in real-time:
 * - Sensor data: Update every 1 minute, send every 4 seconds (repeat same message)
 * - Trading data: Send immediately when new trades occur
 */

require('dotenv').config();
const { authorizeGoogleSheets, readTradesFromSheet, readReplayFeed } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { spawn } = require('child_process');
const path = require('path');
const { createTickerMessages } = require('./tickerTape');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_MAC = process.env.BLE_MAC || '410B2C35-FBEB-A20E-CB42-C690C2A28E2D';
let sheets = null;

// Function to send data to BLE device
function sendToBLE(line1, line2, options = {}) {
  return new Promise((resolve, reject) => {
    const ipixelPath = path.join(__dirname, 'vendor/iPixel-CLI/ipixelcli.py');
    let pythonExec = options.python;
    
    if (!pythonExec) {
      const venvPython = path.join(__dirname, '.venv', 'bin', 'python3');
      const fs = require('fs');
      if (fs.existsSync(venvPython)) {
        pythonExec = venvPython;
      } else {
        pythonExec = 'python3';
      }
    }
    
    const mac = options.mac || BLE_MAC;
    const scroll = options.scroll !== false;
    const scrollOnce = options.scrollOnce !== false;
    const periodMs = options.periodMs || 26;
    const step = options.step || 2;
    const align = options.align || 'center';

    const ipixelAbs = path.resolve(ipixelPath);
    const ipixelDir = path.dirname(ipixelAbs);
    const twoLinePy = path.join(ipixelDir, 'two_line_png.py');
    
    const extras = [];
    if (scroll) extras.push('scroll=1');
    if (scrollOnce) extras.push('scroll_once=1');
    extras.push(`period_ms=${periodMs}`);
    extras.push(`step=${step}`);
    extras.push(`align=${align}`);

    const cmd = [pythonExec, twoLinePy, mac, line1, line2, ...extras];

    console.log(`📤 Sending to BLE: "${line1}" / "${line2}"`);
    
    const childProcess = spawn(cmd[0], cmd.slice(1), {
      cwd: ipixelDir,
      stdio: 'inherit',
      env: { ...process.env }
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`BLE send failed with code ${code}`));
      }
    });

    childProcess.on('error', (error) => {
      reject(error);
    });
  });
}

// Get latest sensor data from Replay Feed
async function getLatestSensorData() {
  try {
    const sensorData = await readReplayFeed(100, 'Replay Feed');
    if (sensorData.length === 0) return null;
    
    // Get the most recent sensor reading
    const latest = sensorData[sensorData.length - 1];
    
    return {
      lux: parseFloat(latest.lux) || 0,
      temperature: parseFloat(latest.temperature) || 0,
      humidity: parseFloat(latest.humidity) || 0,
      current: parseFloat(latest.current) || 0,
      power: parseFloat(latest.power) || 0
    };
  } catch (error) {
    console.error('❌ Error reading sensor data:', error.message);
    return null;
  }
}

// Check if market is open
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

// Convert sensor data to BLE message
function sensorToBLEMessage(sensor) {
  if (!sensor) return null;
  
  // Determine mood
  const isBright = sensor.lux > 20000;
  const isHot = sensor.temperature > 15;
  const isDry = sensor.humidity < 50;
  let mood = 'Unknown';
  if (isBright && isDry && isHot) mood = 'Hot & Dry';
  else if (isBright && isDry) mood = 'Bright & Dry';
  else if (isBright && !isDry) mood = 'Bright & Wet';
  else if (!isBright && isDry) mood = 'Dry & Cloudy';
  else mood = 'Dark & Wet';
  
  // Check market status
  const marketOpen = isMarketHours();
  
  // Get suggested stocks based on mood
  const moodStockMap = {
    "Bright & Dry": ["MSFT", "GOOG"],
    "Cold & Bright": ["INTC", "IBM"],
    "Hot & Dry": ["SPWR", "SEDG"],
    "Hot & Humid": ["DASH", "UBER"],
    "Dark & Wet": ["NEE", "WM"],
    "Dry & Cloudy": ["PFE", "ABT"],
    "Bright & Wet": ["NKE", "LULU"],
    "Cold & Wet": ["TGT", "COST"]
  };
  const suggestedStocks = moodStockMap[mood] || [];
  
  const messages = createTickerMessages({
    sensor: sensor,
    mood: mood,
    suggestedStocks: suggestedStocks,
    market: { open: marketOpen }
  });
  
  const message = messages[0] || '';
  const lines = message.split('\n');
  
  return {
    line1: lines[0] || '',
    line2: lines[1] || '',
    finalDisplayText: message
  };
}

// Get latest trading data from Alpaca Trades
async function getLatestTrades(lastTradeTimestamp = 0) {
  try {
    const trades = await readTradesFromSheet(100, 'Alpaca Trades');
    
    // Filter for 1/5 EST trades
    const jan5Trades = trades.filter(trade => {
      if (!trade.tsMs) return false;
      const tradeDate = new Date(trade.tsMs);
      const estDate = new Date(tradeDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      return estDate.getFullYear() === 2026 &&
             estDate.getMonth() === 0 &&
             estDate.getDate() === 5 &&
             trade.tsMs > lastTradeTimestamp;
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    return jan5Trades;
  } catch (error) {
    console.error('❌ Error reading trades:', error.message);
    return [];
  }
}

// Convert trade to BLE message
function tradeToBLEMessage(trade, sensor) {
  const { formatActivePosition, formatExit } = require('./tickerTape');
  
  if (trade.exitPrice && trade.exitPrice > 0) {
    // Closed trade (EXIT)
    const exitData = {
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnlPct: trade.pnlPercent || 0,
      reason: trade.reason || 'EXIT',
      heldMinutes: 0
    };
    const formatted = formatExit(exitData);
    const lines = formatted.split('\n');
    return {
      line1: lines[0] || '',
      line2: lines[1] || '',
      finalDisplayText: formatted,
      priority: 'high' // Trading messages have high priority
    };
  } else {
    // Open position (POSITION)
    const positionData = {
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      size: trade.shares,
      pnlPct: 0,
      slPct: 2.0,
      tpPct: 4.0,
      holdMinutesLeft: 30,
      equity: 93461
    };
    const formatted = formatActivePosition(positionData);
    const lines = formatted.split('\n');
    return {
      line1: lines[0] || '',
      line2: lines[1] || '',
      finalDisplayText: formatted,
      priority: 'high'
    };
  }
}

async function sendBLERealtime() {
  try {
    console.log('🔐 Authorizing Google Sheets...\n');
    await authorizeGoogleSheets();
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log('🚀 Starting real-time BLE transmission...\n');
    console.log('   - 기상 데이터: 1분마다 업데이트, 4초마다 전송');
    console.log('   - 트레이딩 데이터: 실시간 전송\n');

    let currentSensorMessage = null;
    let lastTradeTimestamp = 0;
    let lastSensorUpdate = 0;

    // Update sensor data every 1 minute
    const updateSensorData = async () => {
      const now = Date.now();
      if (now - lastSensorUpdate < 60000) return; // Don't update more than once per minute
      
      console.log('📡 Updating sensor data...');
      const sensor = await getLatestSensorData();
      if (sensor) {
        currentSensorMessage = sensorToBLEMessage(sensor);
        lastSensorUpdate = now;
        console.log(`✅ Sensor data updated: LUX=${sensor.lux}, TEMP=${sensor.temperature}°C, HUM=${sensor.humidity}%`);
      }
    };

    // Check for new trades
    const checkTrades = async () => {
      const newTrades = await getLatestTrades(lastTradeTimestamp);
      if (newTrades.length > 0) {
        console.log(`📈 Found ${newTrades.length} new trade(s)!`);
        for (const trade of newTrades) {
          const sensor = await getLatestSensorData();
          const tradeMessage = tradeToBLEMessage(trade, sensor);
          if (tradeMessage) {
            console.log(`📤 Sending trade message: ${trade.symbol} ${trade.side}`);
            try {
              await sendToBLE(tradeMessage.line1, tradeMessage.line2, {
                mac: BLE_MAC,
                scroll: true,
                scrollOnce: true,
                periodMs: 26,
                step: 2,
                align: 'center'
              });
              console.log('✅ Trade message sent successfully!\n');
            } catch (error) {
              console.error('❌ Error sending trade message:', error.message);
            }
          }
          lastTradeTimestamp = Math.max(lastTradeTimestamp, trade.tsMs);
        }
      }
    };

    // Send sensor message every 4 seconds
    const sendSensorLoop = async () => {
      // Update sensor data if needed
      await updateSensorData();
      
      // Send current sensor message
      if (currentSensorMessage) {
        try {
          await sendToBLE(currentSensorMessage.line1, currentSensorMessage.line2, {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 26,
            step: 2,
            align: 'center'
          });
        } catch (error) {
          console.error('❌ Error sending sensor message:', error.message);
        }
      } else {
        // First time - get initial sensor data
        await updateSensorData();
      }
      
      // Check for new trades
      await checkTrades();
      
      // Wait 4 seconds before next send
      setTimeout(sendSensorLoop, 4000);
    };

    // Initial sensor data load
    await updateSensorData();
    
    // Start sending loop
    console.log('✅ Starting transmission loop...\n');
    sendSensorLoop();

    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error in sendBLERealtime:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  sendBLERealtime();
}

module.exports = { sendBLERealtime, sendToBLE };

