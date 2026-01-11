#!/usr/bin/env node
/**
 * Send BLE Content data with Stage 1 → 2 → 1 → 2 loop
 * - Reads from BLE Content sheet (EST_TIME, STAGE, LINE1, LINE2)
 * - Converts EST_TIME to KST (same hour:minute)
 * - Starts from 1/9 KST 9:30
 * - Each EST_TIME: Loop Stage 1 → 2 → 1 → 2... for 1 minute (4 seconds interval)
 * - After 1 minute, move to next EST_TIME
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { spawn } = require('child_process');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_MAC = process.env.BLE_MAC || '410B2C35-FBEB-A20E-CB42-C690C2A28E2D';
const BLE_CONTENT_SHEET = 'BLE Content';
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

// Function to read BLE Content data
async function readBLEContentData() {
  if (!sheets || !SPREADSHEET_ID) {
    throw new Error('Google Sheets not configured');
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:E`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return [];
    }

    // Skip header row
    const dataRows = rows.slice(1);
    const contentData = [];

    for (const row of dataRows) {
      const estTime = row[0] || '';
      const stage = row[1] || '';
      const messageType = row[2] || '';
      const line1 = row[3] || '';
      const line2 = row[4] || '';

      // Validate EST_TIME format (e.g., "9:35" or "09:35")
      if (estTime && estTime.match(/^\d{1,2}:\d{2}$/) && stage && (stage === '1' || stage === '2')) {
        contentData.push({
          estTime,
          stage: parseInt(stage),
          messageType,
          line1,
          line2
        });
      }
    }

    // Group by EST_TIME
    const groupedByTime = new Map();
    for (const item of contentData) {
      if (!groupedByTime.has(item.estTime)) {
        groupedByTime.set(item.estTime, {
          estTime: item.estTime,
          stage1: null,
          stage2: null
        });
      }
      const group = groupedByTime.get(item.estTime);
      if (item.stage === 1) {
        group.stage1 = item;
      } else if (item.stage === 2) {
        group.stage2 = item;
      }
    }

    // Convert to array and sort by EST_TIME
    const sortedGroups = Array.from(groupedByTime.values()).sort((a, b) => {
      const [aHour, aMin] = a.estTime.split(':').map(Number);
      const [bHour, bMin] = b.estTime.split(':').map(Number);
      const aTotalMin = aHour * 60 + aMin;
      const bTotalMin = bHour * 60 + bMin;
      return aTotalMin - bTotalMin;
    });

    return sortedGroups;
  } catch (error) {
    console.error('❌ Error reading BLE Content data:', error.message);
    throw error;
  }
}

async function sendBLEContentReplay() {
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

    // Read BLE Content data
    console.log(`📖 Reading BLE Content data...\n`);
    const contentGroups = await readBLEContentData();

    if (contentGroups.length === 0) {
      console.error('❌ No data found in BLE Content sheet');
      return;
    }

    console.log(`✅ Found ${contentGroups.length} time slots in BLE Content\n`);

    // Filter: Start from 9:30 EST (KST 9:30)
    const startTime = '9:30';
    const filteredGroups = contentGroups.filter(group => {
      const [hour, min] = group.estTime.split(':').map(Number);
      const [startHour, startMin] = startTime.split(':').map(Number);
      const totalMin = hour * 60 + min;
      const startTotalMin = startHour * 60 + startMin;
      return totalMin >= startTotalMin;
    });

    if (filteredGroups.length === 0) {
      console.error('❌ No data found starting from 9:30');
      return;
    }

    console.log(`📊 Using ${filteredGroups.length} time slots starting from ${startTime} EST\n`);

    // Get current KST time
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const currentHour = kst.getHours();
    const currentMinute = kst.getMinutes();
    const currentKey = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    // Find starting index: match current KST hour:minute (or start from 9:30)
    const startKey = '09:30';
    let currentIndex = 0;
    
    for (let i = 0; i < filteredGroups.length; i++) {
      const group = filteredGroups[i];
      const [hour, min] = group.estTime.split(':').map(Number);
      const groupKey = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      
      // Start from 9:30 or current time (whichever is later)
      if (groupKey >= startKey && groupKey >= currentKey) {
        currentIndex = i;
        break;
      }
    }

    console.log(`📌 Starting from time slot ${currentIndex + 1}/${filteredGroups.length}`);
    console.log(`   EST_TIME: ${filteredGroups[currentIndex].estTime}`);
    console.log(`   Current KST: ${kst.toLocaleTimeString('ko-KR')} (${currentKey})\n`);

    // State for current minute loop
    let currentStage = 1; // Start with Stage 1
    let minuteStartTime = Date.now();
    const MINUTE_DURATION = 60000; // 1 minute
    const STAGE_INTERVAL = 4000; // 4 seconds

    const sendNext = async () => {
      // Check if we need to move to next EST_TIME (after 1 minute)
      const now = Date.now();
      const elapsedInMinute = now - minuteStartTime;

      if (elapsedInMinute >= MINUTE_DURATION) {
        // Move to next EST_TIME
        currentIndex++;
        currentStage = 1; // Reset to Stage 1
        minuteStartTime = now;

        // If we've reached the end, restart from beginning
        if (currentIndex >= filteredGroups.length) {
          console.log('\n✅ All time slots completed. Restarting from beginning...\n');
          currentIndex = 0;
        }
      }

      const group = filteredGroups[currentIndex];
      if (!group) {
        setTimeout(sendNext, STAGE_INTERVAL);
        return;
      }

      // Get current stage data
      const stageData = currentStage === 1 ? group.stage1 : group.stage2;

      if (stageData) {
        const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        console.log(`\n[${currentIndex + 1}/${filteredGroups.length}] ${kstNow} - EST ${group.estTime} - Stage ${currentStage}`);
        console.log(`   Type: ${stageData.messageType}`);
        
        try {
          const spacePrefix = '          '; // 10 spaces
          await sendToBLE(
            spacePrefix + (stageData.line1 || ''),
            spacePrefix + (stageData.line2 || ''),
            {
              mac: BLE_MAC,
              scroll: true,
              scrollOnce: true,
              periodMs: 26,
              step: 2,
              align: 'center'
            }
          );
          
          console.log(`   ✅ Stage ${currentStage} sent`);
        } catch (error) {
          console.error(`   ❌ Error sending Stage ${currentStage}:`, error.message);
        }
      } else {
        console.log(`   ⚠️ No Stage ${currentStage} data for EST ${group.estTime}`);
      }

      // Toggle stage: 1 → 2 → 1 → 2...
      currentStage = currentStage === 1 ? 2 : 1;

      // Wait 4 seconds before next stage
      setTimeout(sendNext, STAGE_INTERVAL);
    };

    console.log('🚀 Starting BLE Content transmission...\n');
    console.log('   EST_TIME을 KST 시간으로 변환하여 전송합니다.\n');
    console.log('   각 EST_TIME마다 1분 동안 Stage 1 → 2 → 1 → 2... 반복 (4초 간격)\n');
    
    sendNext();

    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error in sendBLEContentReplay:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  sendBLEContentReplay();
}

module.exports = { sendBLEContentReplay, sendToBLE };

