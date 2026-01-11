#!/usr/bin/env node
/**
 * Send a sample BLE message with stock order and hold time
 * Uses real-time temperature from replay log to determine which stock to use
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

const BLE_MAC = process.env.BLE_MAC || '410B2C35-FBEB-A20E-CB42-C690C2A28E2D';

// Determine trade mood based on sensor data (same logic as index.js)
function determineTradeMood({ lux, temperature, humidity }) {
  const isBright = lux > 20000;
  const isDark = lux <= 20000;
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

// Mood to stock mapping (same as index.js)
const moodStockMap = {
  "Bright & Dry": ["MSFT", "GOOG"], // Clear tech leaders
  "Cold & Bright": ["INTC", "IBM"], // Established tech with measured growth
  "Hot & Dry": ["SPWR", "SEDG"], // Solar energy, capturing heat
  "Hot & Humid": ["DASH", "UBER"], // Fast-moving delivery
  "Dark & Wet": ["NEE", "WM"], // Utilities, waste management - essentials
  "Dry & Cloudy": ["PFE", "ABT"], // Healthcare, stability in uncertainty
  "Bright & Wet": ["NKE", "LULU"], // Activewear, thriving after rain
  "Cold & Wet": ["TGT", "COST"] // Retail basics, essentials
};

function sendToBLE(line1, line2, options = {}) {
  return new Promise((resolve, reject) => {
    const ipixelPath = path.join(__dirname, 'vendor/iPixel-CLI/ipixelcli.py');
    const twoLinePngPath = path.join(__dirname, 'vendor/iPixel-CLI/two_line_png.py');
    let pythonExec = options.python;
    
    // Auto-detect Python from .venv
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
    const periodMs = options.periodMs || 26; // 2x slower
    const step = options.step || 2; // 2x slower
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
    console.log(`   Options: scroll=${scroll}, scroll_once=${scrollOnce}, period_ms=${periodMs}, step=${step}`);
    console.log(`   Python: ${pythonExec}`);
    
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

async function sendSampleOrder() {
  try {
    // Read latest sensor data from replay log
    console.log('📖 Reading latest sensor data from replay log...\n');
    await authorizeGoogleSheets();
    const replayData = await readReplayFeed(100, 'Replay Feed');
    
    let sensor;
    if (replayData && replayData.length > 0) {
      // Get the most recent entry (last in array)
      const latest = replayData[replayData.length - 1];
      sensor = {
        lux: parseFloat(latest.lux) || 25000,
        temperature: parseFloat(latest.temperature) || 28,
        humidity: parseFloat(latest.humidity) || 45,
        current: parseFloat(latest.current) || 120,
        power: parseFloat(latest.power) || 350
      };
      console.log(`✅ Latest sensor data: Lux=${sensor.lux}, Temp=${sensor.temperature}°C, Humidity=${sensor.humidity}%`);
    } else {
      // Fallback to sample data if no replay data found
      console.log('⚠️ No replay data found, using sample data');
      sensor = {
        lux: 25000,
        temperature: 28,
        humidity: 45,
        current: 120,
        power: 350
      };
    }

    // Determine mood and stock based on real sensor data
    const mood = determineTradeMood(sensor);
    const suggestedStocks = moodStockMap[mood] || [];
    const symbol = suggestedStocks[0] || 'TSLA'; // Use first suggested stock or fallback
    
    console.log(`🌤️  Mood: ${mood}`);
    console.log(`📈 Suggested stocks: ${suggestedStocks.join(', ')}`);
    console.log(`🎯 Using stock: ${symbol}\n`);

    // Format sun line (LUX TEMP HUM PWR)
    const luxStr = Math.round(sensor.lux / 1000);
    const tempStr = Math.round(sensor.temperature);
    const humStr = Math.round(sensor.humidity);
    const pwrStr = sensor.power.toFixed(2);
    const line1 = `LUX ${luxStr}k TEMP ${tempStr} HUM ${humStr} PWR ${pwrStr}`;

    // Sample active position with hold time (주식 사고 있는 상태)
    // Format from tickerTape.js formatActivePosition:
    // Line 1: SYMBOL LONG @ PRICE P/L X% ARROW
    // Line 2: SL X% TP Y% SIZE Z HOLD Nm EQT $XXX
    const side = 'LONG'; // LONG or SHORT
    const entryPrice = '245.50'; // Entry price (sample)
    const pnlPct = '1.25'; // Profit/Loss percentage (sample)
    const sl = '2.0'; // Stop Loss 2%
    const tp = '4.0'; // Take Profit 4%
    const size = '10'; // 10 shares
    const hold = '12'; // Hold 12 minutes left
    const equity = '93,461'; // Sample equity
    const line2 = `${symbol} ${side} @ ${entryPrice} P/L ${pnlPct}%`;
    const line3 = `SL ${sl}% TP ${tp}% SIZE ${size} HOLD ${hold}m EQT $${equity}`;

    console.log('🚀 Starting continuous sample position message sending (1 second interval)...\n');
    console.log(`   Line 1: ${line1}`);
    console.log(`   Line 2: ${line2}`);
    console.log(`   Line 3: ${line3}\n`);
    
    let count = 0;
    const sendLoop = async () => {
      try {
        count++;
        const startTime = Date.now();
        console.log(`[${count}] Sending... (${new Date().toLocaleTimeString()})`);
        await sendToBLE(line1, line2, {
          mac: BLE_MAC,
          scroll: true,
          scrollOnce: true,
          periodMs: 26,
          step: 2,
          align: 'center'
        });
        const elapsed = Date.now() - startTime;
        console.log(`✅ Sent successfully! (took ${elapsed}ms)`);
        
        // Wait 1 second after transmission completes
        const waitTime = Math.max(0, 1000 - elapsed);
        console.log(`   Next in ${waitTime}ms...\n`);
        setTimeout(sendLoop, waitTime);
      } catch (error) {
        console.error(`❌ Error sending message [${count}]:`, error.message);
        console.log('⏳ Retrying in 1 second...\n');
        setTimeout(sendLoop, 1000);
      }
    };
    
    // Start the loop
    sendLoop();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  sendSampleOrder();
}

module.exports = { sendToBLE, sendSampleOrder };

