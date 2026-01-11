#!/usr/bin/env node
/**
 * Send BLE Display data for yesterday's trading (1/4 EST) and today's sensor data (1/5 KST)
 * Starts immediately and sends at 1 second intervals
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

// Function to read BLE Display data for multiple dates
async function readBLEDisplayDataMultipleDates(dates) {
  if (!sheets || !SPREADSHEET_ID) {
    throw new Error('Google Sheets not configured');
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('⚠️ No data found in BLE Display sheet');
      return [];
    }

    const dataRows = rows.slice(1);
    const allFilteredData = [];

    // Process each target date
    for (const { dateStr, timezone, messageTypes } of dates) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const targetYear = year;
      const targetMonth = month - 1; // 0-indexed
      const targetDay = day;

      const filteredData = dataRows
        .map((row, idx) => {
          const timestamp = row[0];
          const messageType = row[1];
          const line1 = row[2];
          const line2 = row[3];
          const finalDisplayText = row[4];

          if (!timestamp) return null;

          let date;
          try {
            date = new Date(timestamp);
            if (isNaN(date.getTime())) return null;
          } catch (e) {
            return null;
          }

          // Check date in specified timezone
          const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
          const matchesTzDate = 
            tzDate.getFullYear() === targetYear &&
            tzDate.getMonth() === targetMonth &&
            tzDate.getDate() === targetDay;

          // Also check UTC date
          const utcDate = new Date(timestamp);
          const matchesUtcDate = 
            utcDate.getFullYear() === targetYear &&
            utcDate.getMonth() === targetMonth &&
            utcDate.getDate() === targetDay;

          if (!matchesTzDate && !matchesUtcDate) return null;

          // Filter by message types if specified
          if (messageTypes && messageTypes.length > 0) {
            if (!messageTypes.includes(messageType)) return null;
          }

          return {
            timestamp,
            date: tzDate,
            messageType,
            line1,
            line2,
            finalDisplayText,
            rowIndex: idx + 2
          };
        })
        .filter(item => item !== null);

      allFilteredData.push(...filteredData);
    }

    // Sort all data by timestamp
    allFilteredData.sort((a, b) => a.date.getTime() - b.date.getTime());

    return allFilteredData;
  } catch (error) {
    console.error('❌ Error reading BLE Display data:', error.message);
    throw error;
  }
}

// Function to send data to BLE device
function sendToBLE(line1, line2, options = {}) {
  return new Promise((resolve, reject) => {
    const ipixelPath = path.join(__dirname, 'vendor/iPixel-CLI/ipixelcli.py');
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

async function sendBLEToday() {
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

    // Get current dates
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    // Yesterday's trading (EST 1/4) - trading messages only
    const yesterdayEst = new Date(est);
    yesterdayEst.setDate(yesterdayEst.getDate() - 1);
    const yesterdayDateStr = `${yesterdayEst.getFullYear()}-${String(yesterdayEst.getMonth() + 1).padStart(2, '0')}-${String(yesterdayEst.getDate()).padStart(2, '0')}`;
    
    // Today's sensor data (KST 1/5)
    const todayKstDateStr = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`;
    
    console.log('📅 데이터 수집:');
    console.log(`   어젯밤 트레이딩: ${yesterdayDateStr} (EST) - ORDER, POSITION, EXIT 메시지`);
    console.log(`   오늘 기상 데이터: ${todayKstDateStr} (KST) - 모든 메시지\n`);

    // Read data for both dates
    const dates = [
      {
        dateStr: yesterdayDateStr,
        timezone: 'America/New_York',
        messageTypes: ['ORDER', 'POSITION', 'EXIT'] // Trading messages only
      },
      {
        dateStr: todayKstDateStr,
        timezone: 'Asia/Seoul',
        messageTypes: null // All messages
      }
    ];

    console.log('📖 Reading BLE Display data...\n');
    const data = await readBLEDisplayDataMultipleDates(dates);

    if (data.length === 0) {
      console.error(`❌ No data found for ${yesterdayDateStr} (EST) or ${todayKstDateStr} (KST) in BLE Display sheet`);
      return;
    }

    console.log(`✅ Found ${data.length} messages total`);
    console.log(`   Time range: ${data[0].date.toLocaleTimeString('ko-KR')} - ${data[data.length - 1].date.toLocaleTimeString('ko-KR')}`);
    console.log('');

    // Send messages
    let currentIndex = 0;
    const sendNext = async () => {
      if (currentIndex >= data.length) {
        console.log('\n✅ All messages sent. Restarting from beginning...\n');
        currentIndex = 0;
        setTimeout(sendNext, 1000);
        return;
      }

      const item = data[currentIndex];
      const { line1, line2, finalDisplayText, date, messageType } = item;

      const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`[${currentIndex + 1}/${data.length}] ${kstNow} - ${messageType}`);
      
      try {
        const startTime = Date.now();
        if (finalDisplayText) {
          const lines = finalDisplayText.split('\n');
          await sendToBLE(lines[0] || line1, lines[1] || line2, {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 26,
            step: 2,
            align: 'center'
          });
        } else {
          await sendToBLE(line1 || '', line2 || '', {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 26,
            step: 2,
            align: 'center'
          });
        }
        const elapsed = Date.now() - startTime;
        console.log(`✅ Sent successfully! (took ${elapsed}ms)`);
        
        currentIndex++;

        // Wait 1 second after transmission completes
        const waitTime = Math.max(0, 1000 - elapsed);
        console.log(`   Next in ${waitTime}ms...\n`);
        setTimeout(sendNext, waitTime);
      } catch (error) {
        console.error(`❌ Error sending message ${currentIndex + 1}:`, error.message);
        currentIndex++;
        setTimeout(sendNext, 5000); // Retry after 5 seconds
      }
    };

    console.log('🚀 Starting BLE transmission (1 second interval)...\n');
    sendNext();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error in sendBLEToday:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  sendBLEToday();
}

module.exports = { sendBLEToday, sendToBLE };

