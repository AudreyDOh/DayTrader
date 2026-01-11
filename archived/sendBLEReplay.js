#!/usr/bin/env node
/**
 * Script to send 1/2 BLE Display data to Bluetooth LED Ticker Tape
 * Reads from "BLE Display" Google Sheet and sends to BLE device
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { spawn } = require('child_process');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_MAC = process.env.BLE_MAC || '410B2C35-FBEB-A20E-CB42-C690C2A28E2D';
const SHEET_NAME = 'BLE Display';
let sheets = null;

async function readBLEDisplayData(targetDate = '2026-01-02') {
  if (!sheets || !SPREADSHEET_ID) {
    throw new Error('Google Sheets not configured');
  }

  try {
    // Read all data from BLE Display sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('⚠️ No data found in BLE Display sheet');
      return [];
    }

    // Skip header row (row 1)
    const dataRows = rows.slice(1);
    
    // Filter for target date (1/2/2026)
    const targetYear = 2026;
    const targetMonth = 0; // January (0-indexed)
    const targetDay = 2;

    const filteredData = dataRows
      .map((row, idx) => {
        // Map row to object
        // Columns: timestamp, message_type, line1, line2, final_display_text, ...
        const timestamp = row[0];
        const messageType = row[1];
        const line1 = row[2];
        const line2 = row[3];
        const finalDisplayText = row[4];

        if (!timestamp) {
          return null;
        }

        // Parse timestamp (could be ISO string or date string)
        let date;
        try {
          date = new Date(timestamp);
          if (isNaN(date.getTime())) {
            return null;
          }
        } catch (e) {
          return null;
        }

        // Check if date matches target date
        // Try both UTC date and KST date to handle timezone differences
        const utcYear = date.getUTCFullYear();
        const utcMonth = date.getUTCMonth();
        const utcDay = date.getUTCDate();
        
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const kstYear = kstDate.getFullYear();
        const kstMonth = kstDate.getMonth();
        const kstDay = kstDate.getDate();
        
        // Match if either UTC or KST date matches target
        const matchesDate = 
          (utcYear === targetYear && utcMonth === targetMonth && utcDay === targetDay) ||
          (kstYear === targetYear && kstMonth === targetMonth && kstDay === targetDay);

        if (!matchesDate) {
          return null;
        }

        // Use KST date for display and sorting
        return {
          timestamp,
          date: kstDate,
          messageType,
          line1,
          line2,
          finalDisplayText: finalDisplayText || (line1 && line2 ? `${line1}\n${line2}` : ''),
          rowIndex: idx + 2 // +2 because we skipped header and 0-indexed
        };
      })
      .filter(item => item !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime()); // Sort by time

    return filteredData;
  } catch (error) {
    console.error('❌ Error reading BLE Display data:', error.message);
    throw error;
  }
}

function sendToBLE(line1, line2, options = {}) {
  return new Promise((resolve, reject) => {
    const ipixelPath = path.join(__dirname, 'vendor/iPixel-CLI/ipixelcli.py');
    const twoLinePngPath = path.join(__dirname, 'vendor/iPixel-CLI/two_line_png.py');
    
    // Try to use python from .venv if it exists, otherwise use system python3
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
    
    // Use same options as ble_ticker.py (PNG_SCROLL=1 PNG_SCROLL_ONCE=1 PNG_STEP=3 PNG_PERIOD_MS=20)
    const scroll = options.scroll !== false; // Default true (like PNG_SCROLL=1)
    const scrollOnce = options.scrollOnce !== false; // Default true (like PNG_SCROLL_ONCE=1)
    const periodMs = options.periodMs || 20; // Default 20 (like PNG_PERIOD_MS=20)
    const step = options.step || 3; // Default 3 (like PNG_STEP=3)
    const align = options.align || 'center';

    // Build command exactly like ble_ticker.py's send_two_line_png
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
      env: { ...process.env } // Inherit environment (including .venv if activated)
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

async function sendBLEReplay(options = {}) {
  const {
    targetDate = '2026-01-02',
    interval = 60, // seconds between messages
    speed = 1, // replay speed multiplier (1 = real-time)
    once = false // send once and exit
  } = options;

  try {
    // Authorize Google Sheets
    console.log('🔐 Authorizing Google Sheets...');
    await authorizeGoogleSheets();
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    // Read BLE Display data
    console.log(`📖 Reading BLE Display data for ${targetDate}...`);
    const data = await readBLEDisplayData(targetDate);

    if (data.length === 0) {
      console.error(`❌ No data found for ${targetDate} in BLE Display sheet`);
      return;
    }

    console.log(`✅ Found ${data.length} messages for ${targetDate}`);
    console.log(`   Time range: ${data[0].date.toLocaleTimeString('ko-KR')} - ${data[data.length - 1].date.toLocaleTimeString('ko-KR')}`);
    console.log('');

    // Send messages
    let currentIndex = 0;
    const sendNext = async () => {
      if (currentIndex >= data.length) {
        if (once) {
          console.log('✅ All messages sent');
          process.exit(0);
        } else {
          console.log('🔄 Reached end, restarting from beginning...');
          currentIndex = 0;
        }
        return;
      }

      const item = data[currentIndex];
      const { line1, line2, finalDisplayText, date, messageType } = item;

      console.log(`[${currentIndex + 1}/${data.length}] ${date.toLocaleTimeString('ko-KR')} - ${messageType}`);
      
      try {
        // Use final_display_text if available, otherwise combine line1 and line2
        // Use same options as ble_ticker.py: PNG_SCROLL=1 PNG_SCROLL_ONCE=1 PNG_STEP=3 PNG_PERIOD_MS=20
        if (finalDisplayText) {
          const lines = finalDisplayText.split('\n');
          await sendToBLE(lines[0] || line1, lines[1] || line2, {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 20,
            step: 3,
            align: 'center'
          });
        } else {
          await sendToBLE(line1 || '', line2 || '', {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 20,
            step: 3,
            align: 'center'
          });
        }

        currentIndex++;

        // Calculate delay to next message
        if (currentIndex < data.length) {
          const nextItem = data[currentIndex];
          const timeDiff = (nextItem.date.getTime() - item.date.getTime()) / 1000; // seconds
          const delay = Math.max(1, Math.floor(timeDiff / speed)); // Apply speed multiplier
          console.log(`   ⏱️  Next message in ${delay} seconds\n`);
          setTimeout(sendNext, delay * 1000);
        } else {
          if (once) {
            console.log('✅ All messages sent');
            process.exit(0);
          } else {
            console.log('🔄 Reached end, restarting from beginning...');
            currentIndex = 0;
            setTimeout(sendNext, interval * 1000);
          }
        }
      } catch (error) {
        console.error(`❌ Error sending message ${currentIndex + 1}:`, error.message);
        currentIndex++;
        setTimeout(sendNext, interval * 1000);
      }
    };

    // Start sending
    console.log('🚀 Starting BLE replay...\n');
    sendNext();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// CLI interface
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--date' && args[i + 1]) {
    options.targetDate = args[i + 1];
    i++;
  } else if (arg === '--interval' && args[i + 1]) {
    options.interval = parseInt(args[i + 1]);
    i++;
  } else if (arg === '--speed' && args[i + 1]) {
    options.speed = parseFloat(args[i + 1]);
    i++;
  } else if (arg === '--once') {
    options.once = true;
  } else if (arg === '--mac' && args[i + 1]) {
    BLE_MAC = args[i + 1];
    i++;
  }
}

sendBLEReplay(options).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

