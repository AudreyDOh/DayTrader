#!/usr/bin/env node
/**
 * Send BLE Display data on a scheduled time (KST 9:30 AM - 5:30 PM)
 * Reads data from a specific date and sends during scheduled hours
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

async function readBLEDisplayData(targetDate = '2026-01-03') {
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
    
    // Parse target date
    const [year, month, day] = targetDate.split('-').map(Number);
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

        if (!timestamp) {
          return null;
        }

        let date;
        try {
          date = new Date(timestamp);
          if (isNaN(date.getTime())) {
            return null;
          }
        } catch (e) {
          return null;
        }

        // Check if date matches target date (UTC or KST)
        const utcYear = date.getUTCFullYear();
        const utcMonth = date.getUTCMonth();
        const utcDay = date.getUTCDate();
        
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const kstYear = kstDate.getFullYear();
        const kstMonth = kstDate.getMonth();
        const kstDay = kstDate.getDate();
        
        const matchesDate = 
          (utcYear === targetYear && utcMonth === targetMonth && utcDay === targetDay) ||
          (kstYear === targetYear && kstMonth === targetMonth && kstDay === targetDay);

        if (!matchesDate) {
          return null;
        }

        return {
          timestamp,
          date: kstDate,
          messageType,
          line1,
          line2,
          finalDisplayText: finalDisplayText || (line1 && line2 ? `${line1}\n${line2}` : ''),
          rowIndex: idx + 2
        };
      })
      .filter(item => item !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

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
    const periodMs = options.periodMs || 26; // Default 26ms (2x slower than 1.5x speed, half of current)
    const step = options.step || 2; // Default 2px (2x slower than 1.5x speed, half of current)
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

function isWithinSchedule() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hour = kst.getHours();
  const minute = kst.getMinutes();
  
  // Check if within 9:30 AM - 5:30 PM KST
  const startHour = 9;
  const startMinute = 30;
  const endHour = 17;
  const endMinute = 30;
  
  const currentMinutes = hour * 60 + minute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function getMinutesUntilSchedule() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hour = kst.getHours();
  const minute = kst.getMinutes();
  
  const startHour = 9;
  const startMinute = 30;
  
  const currentMinutes = hour * 60 + minute;
  const startMinutes = startHour * 60 + startMinute;
  
  if (currentMinutes < startMinutes) {
    return startMinutes - currentMinutes;
  }
  return 0;
}

async function sendBLEScheduled(options = {}) {
  const {
    targetDate = '2026-01-03',
    startTime = '09:30', // KST
    endTime = '17:30',   // KST
    speed = 1,
    interval = 2, // Fixed interval in seconds (2 seconds between messages)
    periodMs = 26, // Scroll period in ms (PNG_PERIOD_MS, default 26 = 2x slower than 1.5x speed)
    step = 2 // Scroll step in pixels (PNG_STEP, default 2 = 2x slower than 1.5x speed)
  } = options;

  try {
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

    console.log(`📖 Reading BLE Display data for ${targetDate}...`);
    const data = await readBLEDisplayData(targetDate);

    if (data.length === 0) {
      console.error(`❌ No data found for ${targetDate} in BLE Display sheet`);
      return;
    }

    console.log(`✅ Found ${data.length} messages for ${targetDate}`);
    if (data.length > 0) {
      console.log(`   Time range: ${data[0].date.toLocaleTimeString('ko-KR')} - ${data[data.length - 1].date.toLocaleTimeString('ko-KR')}`);
    }
    console.log('');

    // Wait until scheduled time
    if (!isWithinSchedule()) {
      const minutesUntil = getMinutesUntilSchedule();
      if (minutesUntil > 0) {
        const hours = Math.floor(minutesUntil / 60);
        const mins = minutesUntil % 60;
        console.log(`⏰ 스케줄 시작까지 대기 중...`);
        console.log(`   현재 KST: ${new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
        console.log(`   시작 시간: ${startTime} KST`);
        console.log(`   대기 시간: ${hours}시간 ${mins}분`);
        console.log('');
        
        await new Promise(resolve => setTimeout(resolve, minutesUntil * 60 * 1000));
      } else {
        console.log('⚠️ 스케줄 시간이 지났습니다.');
        console.log(`   현재 KST: ${new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
        console.log(`   시작 시간: ${startTime} KST`);
        return;
      }
    }

    console.log('🚀 스케줄 시작! BLE 전송을 시작합니다...\n');
    console.log(`📊 전송 간격: ${options.interval || 2}초`);
    console.log(`📊 스크롤 속도: period_ms=${options.periodMs || 26}, step=${options.step || 2} (2배 느린 기본값)\n`);

    // Send messages
    let currentIndex = 0;
    const sendNext = async () => {
      // Check if still within schedule
      if (!isWithinSchedule()) {
        console.log('\n✅ 스케줄 종료 시간 도달. 전송을 종료합니다.');
        process.exit(0);
      }

      if (currentIndex >= data.length) {
        console.log('✅ All messages sent');
        process.exit(0);
      }

      const item = data[currentIndex];
      const { line1, line2, finalDisplayText, date, messageType } = item;

      const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`[${currentIndex + 1}/${data.length}] ${kstNow} - ${messageType}`);
      
      try {
        // Use options from command line or defaults
        const periodMs = options.periodMs || 20;
        const step = options.step || 3;
        
        if (finalDisplayText) {
          const lines = finalDisplayText.split('\n');
          await sendToBLE(lines[0] || line1, lines[1] || line2, {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: periodMs,
            step: step,
            align: 'center'
          });
        } else {
          await sendToBLE(line1 || '', line2 || '', {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: periodMs,
            step: step,
            align: 'center'
          });
        }

        currentIndex++;

        // Use fixed interval (default 2 seconds, or use --interval option)
        const interval = options.interval || 2; // Default 2 seconds
        const delay = Math.max(1, Math.floor(interval / speed));
        
        if (currentIndex < data.length) {
          console.log(`   ⏱️  Next message in ${delay} seconds\n`);
          setTimeout(sendNext, delay * 1000);
        } else {
          // Loop back to beginning if not at end of schedule
          if (isWithinSchedule()) {
            console.log('🔄 Reached end, restarting from beginning...\n');
            currentIndex = 0;
            setTimeout(sendNext, delay * 1000);
          } else {
            console.log('✅ All messages sent');
            process.exit(0);
          }
        }
      } catch (error) {
        console.error(`❌ Error sending message ${currentIndex + 1}:`, error.message);
        currentIndex++;
        setTimeout(sendNext, 5000); // Retry after 5 seconds
      }
    };

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
  } else if (arg === '--start' && args[i + 1]) {
    options.startTime = args[i + 1];
    i++;
  } else if (arg === '--end' && args[i + 1]) {
    options.endTime = args[i + 1];
    i++;
  } else if (arg === '--speed' && args[i + 1]) {
    options.speed = parseFloat(args[i + 1]);
    i++;
  } else if (arg === '--interval' && args[i + 1]) {
    options.interval = parseInt(args[i + 1]);
    i++;
  } else if (arg === '--period-ms' && args[i + 1]) {
    options.periodMs = parseInt(args[i + 1]);
    i++;
  } else if (arg === '--step' && args[i + 1]) {
    options.step = parseInt(args[i + 1]);
    i++;
  } else if (arg === '--mac' && args[i + 1]) {
    BLE_MAC = args[i + 1];
    i++;
  }
}

sendBLEScheduled(options).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

