#!/usr/bin/env node
/**
 * Send BLE Display data combining:
 * 1. 1/5 EST trading data from Alpaca Trades
 * 2. 1/5 KST sensor data from BLE Display
 * Sends at current Korean time, 1 second intervals
 */

require('dotenv').config();
const { authorizeGoogleSheets, readTradesFromSheet } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { spawn } = require('child_process');
const path = require('path');
const { formatOrder, formatActivePosition, formatExit } = require('./tickerTape');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_MAC = process.env.BLE_MAC || '410B2C35-FBEB-A20E-CB42-C690C2A28E2D';
const SHEET_NAME = 'BLE Display';
let sheets = null;

// Function to read BLE Display data for a specific date
async function readBLEDisplayData(targetDate, timezone = 'Asia/Seoul') {
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
      return [];
    }

    const dataRows = rows.slice(1);
    const [year, month, day] = targetDate.split('-').map(Number);
    const targetYear = year;
    const targetMonth = month - 1;
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

        const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
        const matchesTzDate = 
          tzDate.getFullYear() === targetYear &&
          tzDate.getMonth() === targetMonth &&
          tzDate.getDate() === targetDay;

        const utcDate = new Date(timestamp);
        const matchesUtcDate = 
          utcDate.getFullYear() === targetYear &&
          utcDate.getMonth() === targetMonth &&
          utcDate.getDate() === targetDay;

        if (!matchesTzDate && !matchesUtcDate) return null;

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
      .filter(item => item !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return filteredData;
  } catch (error) {
    console.error('❌ Error reading BLE Display data:', error.message);
    throw error;
  }
}

// Convert trade data to BLE message format
function tradeToBLEMessage(trade) {
  // Format based on trade state
  // If exitPrice exists, it's a closed trade (EXIT)
  if (trade.exitPrice && trade.exitPrice > 0) {
    const exitData = {
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnlPct: trade.pnlPercent || 0,
      reason: trade.reason || 'EXIT',
      heldMinutes: trade.holdMinutes || 0
    };
    const formatted = formatExit(exitData);
    const lines = formatted.split('\n');
    return {
      timestamp: trade.tsMs,
      date: new Date(trade.tsMs),
      messageType: 'EXIT',
      line1: lines[0] || '',
      line2: lines[1] || '',
      finalDisplayText: formatted
    };
  } else {
    // Open position (POSITION) - use entry price as current price estimate
    const positionData = {
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      size: trade.shares,
      pnlPct: 0, // We don't have current price, use 0
      slPct: 2.0, // Default stop loss
      tpPct: 4.0, // Default take profit
      holdMinutesLeft: 30, // Default
      equity: 93461 // Default
    };
    const formatted = formatActivePosition(positionData);
    const lines = formatted.split('\n');
    return {
      timestamp: trade.tsMs,
      date: new Date(trade.tsMs),
      messageType: 'POSITION',
      line1: lines[0] || '',
      line2: lines[1] || '',
      finalDisplayText: formatted
    };
  }
}

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

async function sendBLEWithTrades() {
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
    
    // 1/5 EST trading data
    const targetEstDate = '2026-01-05';
    const targetKstDate = '2026-01-05';
    
    console.log('📅 데이터 수집:');
    console.log(`   1/5 트레이딩: ${targetEstDate} (EST) - Alpaca Trades 시트`);
    console.log(`   1/5 기상 데이터: ${targetKstDate} (KST) - BLE Display 시트\n`);

    // Read trades from Alpaca Trades
    console.log('📖 Reading Alpaca Trades...\n');
    const allTrades = await readTradesFromSheet(1000, 'Alpaca Trades');
    
    // Filter trades for 1/5 EST
    const trades = allTrades.filter(trade => {
      if (!trade.tsMs) return false;
      const tradeDate = new Date(trade.tsMs);
      const estDate = new Date(tradeDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      return estDate.getFullYear() === 2026 &&
             estDate.getMonth() === 0 &&
             estDate.getDate() === 5;
    });
    
    console.log(`✅ Found ${trades.length} trades for 1/5 EST\n`);

    // Read all data from BLE Display (includes sensor data AND position messages)
    console.log('📖 Reading BLE Display data...\n');
    const bleDisplayData = await readBLEDisplayData(targetKstDate, 'Asia/Seoul');
    console.log(`✅ Found ${bleDisplayData.length} messages for 1/5 KST in BLE Display\n`);
    
    // Separate sensor/decision messages from position/order/exit messages
    const sensorData = bleDisplayData.filter(msg => 
      ['DECISION', 'MARKET_CLOSED'].includes(msg.messageType)
    );
    const tradingMessages = bleDisplayData.filter(msg => 
      ['ORDER', 'POSITION', 'EXIT'].includes(msg.messageType)
    );
    
    console.log(`   - 센서/결정 메시지: ${sensorData.length}개`);
    console.log(`   - 트레이딩 메시지 (ORDER/POSITION/EXIT): ${tradingMessages.length}개\n`);

    // Convert Alpaca Trades to BLE messages (only if not already in BLE Display)
    const tradeMessages = trades.map(trade => {
      return tradeToBLEMessage(trade);
    });

    // Combine all messages: BLE Display trading messages (most accurate) + sensor data + Alpaca Trades (fallback)
    // Priority: BLE Display trading messages > Alpaca Trades converted messages
    const allTradingMessages = [...tradingMessages, ...tradeMessages];
    
    // Remove duplicates (same timestamp and symbol)
    const uniqueTradingMessages = [];
    const seen = new Set();
    for (const msg of allTradingMessages) {
      const key = `${msg.timestamp || msg.date.getTime()}_${msg.line1?.split(' ')[0] || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTradingMessages.push(msg);
      }
    }
    
    // Combine all messages and sort by time
    const allMessages = [...sensorData, ...uniqueTradingMessages].sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : a.date.getTime();
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : b.date.getTime();
      return timeA - timeB;
    });

    console.log(`📊 총 ${allMessages.length}개 메시지 준비 완료`);
    console.log(`   - 센서/결정 메시지: ${sensorData.length}개`);
    console.log(`   - 트레이딩 메시지: ${uniqueTradingMessages.length}개`);
    console.log(`     (BLE Display: ${tradingMessages.length}개, Alpaca Trades 변환: ${tradeMessages.length}개)\n`);

    if (allMessages.length === 0) {
      console.error('❌ 전송할 데이터가 없습니다.');
      return;
    }

    // Send messages
    let currentIndex = 0;
    const sendNext = async () => {
      if (currentIndex >= allMessages.length) {
        console.log('\n✅ All messages sent. Restarting from beginning...\n');
        currentIndex = 0;
        setTimeout(sendNext, 1000);
        return;
      }

      const item = allMessages[currentIndex];
      const { line1, line2, finalDisplayText, messageType } = item;

      const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`[${currentIndex + 1}/${allMessages.length}] ${kstNow} - ${messageType}`);
      
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

        const waitTime = Math.max(0, 4000 - elapsed); // 4 seconds interval
        console.log(`   Next in ${waitTime}ms...\n`);
        setTimeout(sendNext, waitTime);
      } catch (error) {
        console.error(`❌ Error sending message ${currentIndex + 1}:`, error.message);
        currentIndex++;
        setTimeout(sendNext, 4000); // Retry after 4 seconds
      }
    };

    console.log('🚀 Starting BLE transmission (4 second interval)...\n');
    sendNext();

    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error in sendBLEWithTrades:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  sendBLEWithTrades();
}

module.exports = { sendBLEWithTrades, sendToBLE };

