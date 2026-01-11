#!/usr/bin/env node
/**
 * Send BLE Display data for 1/5 replay:
 * - 1/5 KST sensor data
 * - 1/5 EST trading data
 * Sends at 1:1 time correspondence (KST time matches original KST time)
 * Example: 1/5 KST 1:00 PM data → sends at 1/6 KST 1:00 PM
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
        let line1 = row[2] || '';
        let line2 = row[3] || '';
        let finalDisplayText = row[4] || '';
        
        // Read sensor data from columns (F, G, H, I, J)
        const lux = row[5] ? parseFloat(row[5]) : null;
        const temperature = row[6] ? parseFloat(row[6]) : null;
        const humidity = row[7] ? parseFloat(row[7]) : null;
        const current = row[8] ? parseFloat(row[8]) : null;
        const power = row[9] ? parseFloat(row[9]) : null;
        
        // Read mood and stocks (K, L, M)
        const mood = row[10] || '';
        const suggestedStock1 = row[11] || '';
        const suggestedStock2 = row[12] || '';

        if (!timestamp) return null;

        let date;
        try {
          date = new Date(timestamp);
          if (isNaN(date.getTime())) return null;
        } catch (e) {
          return null;
        }

        // Check in specified timezone
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

        // Also check EST date (for trading data)
        const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const matchesEstDate = 
          estDate.getFullYear() === targetYear &&
          estDate.getMonth() === targetMonth &&
          estDate.getDate() === targetDay;

        if (!matchesTzDate && !matchesUtcDate && !matchesEstDate) return null;

        // If line1 contains all zeros but we have actual sensor data, reconstruct line1
        if (line1 && (line1.includes('LUX 0') || line1.includes('TEMP 0')) && 
            (lux != null || temperature != null || humidity != null || power != null)) {
          // Reconstruct line1 from actual sensor data
          const formatThousands = (n) => {
            if (n == null || isNaN(n)) return '—';
            const v = Number(n);
            if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`;
            return `${Math.round(v)}`;
          };
          const formatThreeDecimals = (n) => {
            if (n == null || isNaN(n)) return '—';
            return (Math.round(Number(n) * 1000) / 1000).toFixed(3);
          };
          
          const luxStr = formatThousands(lux);
          const tempStr = Math.round(temperature ?? 0);
          const humStr = Math.round(humidity ?? 0);
          const pwrStr = formatThreeDecimals(power);
          
          line1 = `LUX ${luxStr} TEMP ${tempStr} HUM ${humStr} PWR ${pwrStr}`;
          
          // If finalDisplayText exists, update it too
          if (finalDisplayText) {
            const lines = finalDisplayText.split('\n');
            if (lines.length >= 1) {
              lines[0] = line1;
              finalDisplayText = lines.join('\n');
            }
          }
        }

        return {
          timestamp,
          date: tzDate,
          messageType,
          line1,
          line2,
          finalDisplayText,
          // Include raw sensor data for reference
          lux,
          temperature,
          humidity,
          current,
          power,
          mood,
          suggestedStock1,
          suggestedStock2,
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

async function sendBLEReplaySync() {
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

    // Get current date
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    // Target: Yesterday's KST data (어제 한국 데이터를 오늘 같은 시간에 표시)
    // Example: 1/8 KST 9:00 → 1/7 KST 9:00 기상 데이터 + 1/7 EST 9:00 트레이딩 데이터 표시
    const yesterdayKst = new Date(kst);
    yesterdayKst.setDate(yesterdayKst.getDate() - 1);
    const targetYear = yesterdayKst.getFullYear();
    const targetMonth = String(yesterdayKst.getMonth() + 1).padStart(2, '0');
    const targetDay = String(yesterdayKst.getDate()).padStart(2, '0');
    const targetKstDate = `${targetYear}-${targetMonth}-${targetDay}`;
    
    console.log('📅 데이터 수집:');
    console.log(`   타겟 날짜: ${targetKstDate} (KST) - 어제 데이터를 오늘 같은 시간에 표시`);
    console.log(`   현재 한국 시간: ${kst.toLocaleString('ko-KR')}\n`);

    // Read weather data from Replay Feed (1/7 KST 기상 데이터)
    console.log(`📖 Reading Replay Feed (weather data) for ${targetKstDate} (KST)...\n`);
    const sensorData = await readReplayFeed(10000, 'Replay Feed');
    const filteredSensorData = sensorData.filter(d => {
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return kstDate.getFullYear() === targetYear &&
             kstDate.getMonth() === yesterdayKst.getMonth() &&
             kstDate.getDate() === yesterdayKst.getDate();
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    console.log(`✅ Found ${filteredSensorData.length} weather readings for ${targetKstDate} (KST)\n`);
    
    // Read trading data from Alpaca Trades (1/7 EST 트레이딩 데이터)
    console.log(`📖 Reading Alpaca Trades (trading data) for ${targetKstDate} EST...\n`);
    const allTrades = await readTradesFromSheet(1000, 'Alpaca Trades');
    
    // Filter trades for target date (EST)
    const filteredTrades = allTrades.filter(trade => {
      if (!trade.tsMs) return false;
      const tradeDate = new Date(trade.tsMs);
      const estDate = new Date(tradeDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      return estDate.getFullYear() === targetYear &&
             estDate.getMonth() === yesterdayKst.getMonth() &&
             estDate.getDate() === yesterdayKst.getDate();
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    console.log(`✅ Found ${filteredTrades.length} trades for ${targetKstDate} EST\n`);
    
    // Convert trades to BLE messages
    const { formatActivePosition, formatExit } = require('./tickerTape');
    const filteredTradingData = filteredTrades.map(trade => {
      const tradeDate = new Date(trade.tsMs);
      const estDate = new Date(tradeDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      let messageType, message;
      
      if (trade.exitPrice && trade.exitPrice > 0) {
        // EXIT message
        messageType = 'EXIT';
        message = formatExit({
          symbol: trade.symbol,
          side: trade.side,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          reason: trade.reason,
          pnlPct: trade.pnlPercent,
          heldMinutes: null // Not available in Alpaca Trades
        });
      } else if (trade.entryPrice && trade.entryPrice > 0) {
        // POSITION message (active position or entry)
        messageType = 'POSITION';
        message = formatActivePosition({
          symbol: trade.symbol,
          side: trade.side,
          entryPrice: trade.entryPrice,
          pnlPct: trade.pnlPercent || 0,
          size: trade.shares,
          slPct: null, // Not available
          tpPct: null, // Not available
          holdMinutesLeft: null, // Not available
          equity: null // Not available
        });
      } else {
        // Skip trades without entry price
        return null;
      }
      
      const lines = message.split('\n');
      
      return {
        timestamp: trade.tsMs,
        date: estDate,
        messageType: messageType,
        line1: lines[0] || '',
        line2: lines[1] || '',
        finalDisplayText: message,
        isTrading: true
      };
    }).filter(item => item !== null);
    
    // Convert sensor data to weather messages
    const weatherData = filteredSensorData.map(sensor => {
      const date = new Date(sensor.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      
      // Create ticker message from sensor data
      const sensorObj = {
        lux: parseFloat(sensor.lux) || 0,
        temperature: parseFloat(sensor.temperature) || 0,
        humidity: parseFloat(sensor.humidity) || 0,
        current: parseFloat(sensor.current) || 0,
        power: parseFloat(sensor.power) || 0
      };
      
      // Determine mood
      // Weather condition thresholds (adjust these values to change hot/cold/dry/wet/bright thresholds)
      const WEATHER_THRESHOLDS = {
        BRIGHT_LUX: 20000,        // Lux > this value = Bright, <= this value = Dark
        HOT_TEMP: 15,              // Temperature > this value = Hot, <= this value = Cold
        DRY_HUMIDITY: 50           // Humidity < this value = Dry, >= this value = Wet
      };
      const isBright = sensorObj.lux > WEATHER_THRESHOLDS.BRIGHT_LUX;
      const isHot = sensorObj.temperature > WEATHER_THRESHOLDS.HOT_TEMP;
      const isDry = sensorObj.humidity < WEATHER_THRESHOLDS.DRY_HUMIDITY;
      let mood = 'Undecided';
      if (isBright && isDry && isHot) mood = 'Hot & Dry';
      else if (isBright && isDry) mood = 'Bright & Dry';
      else if (isBright && !isDry) mood = 'Bright & Wet';
      else if (!isBright && isDry) mood = 'Dry & Cloudy';
      else mood = 'Dark & Wet';
      
      // Get suggested stocks based on mood (matching index.js)
      const moodStockMap = {
        "Bright & Dry": ["MSFT", "GOOG"],
        "Cold & Bright": ["INTC", "IBM"],
        "Hot & Dry": ["SPWR", "SEDG"],
        "Hot & Humid": ["DASH", "UBER"],
        "Dark & Wet": ["NEE", "WM"],
        "Dry & Cloudy": ["NKE", "LULU"], // Changed from PFE, ABT
        "Bright & Wet": ["NKE", "LULU"],
        "Cold & Wet": ["TGT", "COST"]
      };
      const suggestedStocks = moodStockMap[mood] || [];
      
      // Check if market is open at EST time with same hour:minute as KST
      // 1/7 KST 10:06 기상 데이터 → 1/7 EST 10:06에 마켓이 열려있는지 확인
      // KST hour:minute를 그대로 EST hour:minute로 사용 (같은 날짜)
      const kstHour = kstDate.getHours();
      const kstMinute = kstDate.getMinutes();
      
      // Create EST date with same year/month/day and hour:minute
      // 1/7 KST 10:06 → 1/7 EST 10:06 (not 1/6 EST 8:06 PM)
      const estDate = new Date(kstDate);
      // Get EST timezone representation
      const estTimeStr = estDate.toLocaleString('en-US', { timeZone: 'America/New_York' });
      const estTime = new Date(estTimeStr);
      // Set hour:minute to match KST (same hour:minute, different timezone)
      estTime.setHours(kstHour, kstMinute, 0, 0);
      
      const estDay = estTime.getDay();
      const estHour = estTime.getHours();
      const estMinute = estTime.getMinutes();
      
      // Check if it's a weekday and market hours (9:30 AM - 4:00 PM ET)
      const isWeekday = estDay !== 0 && estDay !== 6;
      const marketOpen = isWeekday && ((estHour > 9 || (estHour === 9 && estMinute >= 30)) && estHour < 16);
      
      const messages = createTickerMessages({
        sensor: sensorObj,
        mood: mood,
        suggestedStocks: suggestedStocks,
        market: { open: marketOpen }
      });
      
      const message = messages[0] || '';
      const lines = message.split('\n');
      
      return {
        timestamp: sensor.tsMs,
        date: kstDate,
        messageType: 'DECISION',
        line1: lines[0] || '',
        line2: lines[1] || '',
        finalDisplayText: message,
        isWeather: true
      };
    });
    
    // Combine weather and trading data
    const allData = [...weatherData, ...filteredTradingData];

    if (allData.length === 0) {
      console.error(`❌ No data found for ${targetKstDate}`);
      return;
    }

    console.log(`✅ Found ${allData.length} messages for ${targetKstDate} KST\n`);

    // Group messages by KST hour:minute
    // 기상 데이터: KST hour:minute로 그룹핑 (예: 9:45)
    // 트레이딩 데이터: EST hour:minute를 KST hour:minute로 변환해서 매칭 (EST 9:45 → KST 9:45 그룹)
    const groupedMessages = [];
    const messageGroups = new Map(); // Key: "HH:MM" (KST), Value: { timestamp, weather, trading }
    
    for (const item of allData) {
      const timestamp = new Date(item.timestamp);
      
      let groupKey;
      let groupTimestamp;
      
      if (item.isWeather || item.messageType === 'DECISION' || item.messageType === 'MARKET_CLOSED') {
        // Weather data: use KST hour:minute
        const kstDate = new Date(timestamp.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const hour = kstDate.getHours();
        const minute = kstDate.getMinutes();
        groupKey = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        groupTimestamp = timestamp.getTime();
      } else if (item.isTrading || item.messageType === 'POSITION' || item.messageType === 'EXIT' || item.messageType === 'ORDER') {
        // Trading data: convert EST hour:minute to KST hour:minute for matching
        // EST 9:45 → KST 9:45 그룹에 매칭 (오늘 9:45 KST에 어제 EST 9:45 트레이딩 데이터 표시)
        const estDate = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const hour = estDate.getHours();
        const minute = estDate.getMinutes();
        groupKey = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        // Use weather data timestamp if available, otherwise use trading timestamp
        groupTimestamp = timestamp.getTime();
      } else {
        continue; // Skip unknown message types
      }
      
      if (!messageGroups.has(groupKey)) {
        messageGroups.set(groupKey, {
          timestamp: groupTimestamp,
          weather: null,
          trading: null
        });
      }
      
      const group = messageGroups.get(groupKey);
      
      // Categorize message
      if (item.isWeather || item.messageType === 'DECISION' || item.messageType === 'MARKET_CLOSED') {
        if (!group.weather) {
          group.weather = item;
          group.timestamp = timestamp.getTime(); // Use weather data timestamp
        }
      } else if (item.isTrading || item.messageType === 'POSITION' || item.messageType === 'EXIT' || item.messageType === 'ORDER') {
        // If multiple trading messages, keep the most recent one
        if (!group.trading || new Date(item.timestamp).getTime() > new Date(group.trading.timestamp).getTime()) {
          group.trading = item;
        }
      }
    }
    
    // Convert map to sorted array (sort by hour:minute)
    for (const [key, group] of messageGroups.entries()) {
      groupedMessages.push(group);
    }
    groupedMessages.sort((a, b) => {
      // Sort by hour:minute (KST time)
      const aDate = new Date(a.timestamp);
      const aKst = new Date(aDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const bDate = new Date(b.timestamp);
      const bKst = new Date(bDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const aHourMin = aKst.getHours() * 60 + aKst.getMinutes();
      const bHourMin = bKst.getHours() * 60 + bKst.getMinutes();
      return aHourMin - bHourMin;
    });
    
    console.log(`📊 Grouped into ${groupedMessages.length} time slots (1-minute intervals)\n`);
    
    // Show time range
    if (groupedMessages.length > 0) {
      const first = groupedMessages[0];
      const last = groupedMessages[groupedMessages.length - 1];
      const firstDate = new Date(first.timestamp);
      const lastDate = new Date(last.timestamp);
      console.log(`⏰ 데이터 시간 범위:`);
      console.log(`   시작: ${firstDate.toLocaleTimeString('ko-KR')} KST`);
      console.log(`   종료: ${lastDate.toLocaleTimeString('ko-KR')} KST\n`);
    }

    // Get last trade info for fallback
    const trades = await readTradesFromSheet(100, 'Alpaca Trades');
    let lastTrade = null;
    if (trades.length > 0) {
      lastTrade = trades[trades.length - 1];
    }

    // Send messages with time matching: 오늘 KST hour:minute에 어제 데이터 표시
    // Example: 1/8 KST 9:45 → 1/7 KST 9:45 기상 + 1/7 EST 9:45 트레이딩
    const nowKst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const currentHour = nowKst.getHours();
    const currentMinute = nowKst.getMinutes();
    const currentKey = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
    
    let currentIndex = 0;
    
    // Find starting index: match current KST hour:minute
    for (let i = 0; i < groupedMessages.length; i++) {
      const group = groupedMessages[i];
      const groupDate = new Date(group.timestamp);
      const groupKst = new Date(groupDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const groupHour = groupKst.getHours();
      const groupMinute = groupKst.getMinutes();
      const groupKey = `${String(groupHour).padStart(2, '0')}:${String(groupMinute).padStart(2, '0')}`;
      
      // Match hour:minute
      if (groupKey === currentKey || (groupHour === currentHour && groupMinute >= currentMinute)) {
        currentIndex = i;
        break;
      }
    }
    
    console.log(`📌 Starting from time slot ${currentIndex + 1}/${groupedMessages.length}`);
    console.log(`   현재 KST: ${nowKst.toLocaleTimeString('ko-KR')} (${currentKey})\n`);
    
    // Update data every 1 minute (find current time's data)
    let lastDataUpdateTime = Date.now();
    const DATA_UPDATE_INTERVAL = 60000; // 1 minute
    
    const sendNext = async () => {
      // Check if we need to update to current time's data (every 1 minute)
      const now = Date.now();
      if (now - lastDataUpdateTime >= DATA_UPDATE_INTERVAL) {
        // Find current time's data index
        const currentKst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const currentHour = currentKst.getHours();
        const currentMinute = currentKst.getMinutes();
        const currentKey = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
        
        // Find matching group
        for (let i = 0; i < groupedMessages.length; i++) {
          const group = groupedMessages[i];
          const groupDate = new Date(group.timestamp);
          const groupKst = new Date(groupDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          const groupHour = groupKst.getHours();
          const groupMinute = groupKst.getMinutes();
          const groupKey = `${String(groupHour).padStart(2, '0')}:${String(groupMinute).padStart(2, '0')}`;
          
          if (groupKey === currentKey || (groupHour === currentHour && groupMinute >= currentMinute)) {
            currentIndex = i;
            break;
          }
        }
        
        lastDataUpdateTime = now;
      }
      
      // If we've reached the end, restart from beginning
      if (currentIndex >= groupedMessages.length) {
        currentIndex = 0;
      }

      const group = groupedMessages[currentIndex];
      
      // Send immediately (no waiting)
      await sendMessageSequence(group, lastTrade);
      
      // Move to next index
      currentIndex++;
      
      // Wait 5 seconds before next message (continuous sending)
      setTimeout(sendNext, 5000);
    };

    // Helper function to check if market is open at a given timestamp (EST time)
    function isMarketOpenAtTimestamp(timestampMs) {
      const date = new Date(timestampMs);
      const est = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const day = est.getDay();
      const hour = est.getHours();
      const minute = est.getMinutes();
      
      // Weekend check
      if (day === 0 || day === 6) return false;
      
      // Market hours: 9:30 AM - 4:00 PM ET
      const marketOpen = hour > 9 || (hour === 9 && minute >= 30);
      const marketClosed = hour >= 16;
      
      return marketOpen && !marketClosed;
    }

    // Helper function to adjust "OPEN IN" time by subtracting 14 hours (KST-EST timezone difference)
    // Also removes "MARKET CLOSED" if market is actually open at that timestamp
    function adjustMarketMessage(text, timestampMs) {
      if (!text) return text;
      
      // Check if market is open at this timestamp
      const marketOpen = isMarketOpenAtTimestamp(timestampMs);
      
      // If market is open, remove "MARKET CLOSED" and "OPEN IN" messages
      if (marketOpen) {
        text = text.replace(/MARKET CLOSED/g, '');
        text = text.replace(/OPEN IN \d+h\d+m/g, '');
        text = text.replace(/OPEN SOON/g, '');
        // Clean up extra spaces
        text = text.replace(/\s+/g, ' ').trim();
      } else {
        // Market is closed, adjust "OPEN IN" time
        const openInPattern = /OPEN IN (\d+)h(\d+)m/g;
        text = text.replace(openInPattern, (match, hours, minutes) => {
          const totalMinutes = parseInt(hours) * 60 + parseInt(minutes);
          const timezoneOffsetMinutes = 14 * 60; // 14 hours = 840 minutes
          const adjustedMinutes = totalMinutes - timezoneOffsetMinutes;
          
          if (adjustedMinutes > 0) {
            const adjHours = Math.floor(adjustedMinutes / 60);
            const adjMins = adjustedMinutes % 60;
            return `OPEN IN ${adjHours}h${adjMins}m`;
          } else {
            return 'OPEN SOON';
          }
        });
      }
      
      return text;
    }

    const sendMessageSequence = async (group, lastTradeFallback) => {
      const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`\n[${currentIndex + 1}/${groupedMessages.length}] ${kstNow} - Sending message sequence`);
      
      try {
        // Step 1: Send weather message (기상 데이터 + 추천 주식)
        // Skip MARKET_CLOSED messages if market is actually open at this timestamp
        if (group.weather) {
          let { line1, line2, finalDisplayText, messageType, timestamp } = group.weather;
          
          // Skip MARKET_CLOSED if market is actually open
          if (messageType === 'MARKET_CLOSED' && isMarketOpenAtTimestamp(timestamp || group.timestamp)) {
            console.log(`   📊 Weather: MARKET_CLOSED (skipped - market is open at this time)`);
            // Skip this weather message, but still send trading message if available
          } else {
            console.log(`   📊 Weather: ${messageType}`);
            
            // Adjust market message based on actual market status
            if (finalDisplayText) {
              finalDisplayText = adjustMarketMessage(finalDisplayText, timestamp || group.timestamp);
              const lines = finalDisplayText.split('\n');
              line1 = lines[0] || line1;
              line2 = lines[1] || line2;
            } else {
              line1 = adjustMarketMessage(line1, timestamp || group.timestamp);
              line2 = adjustMarketMessage(line2, timestamp || group.timestamp);
            }
          
            const spacePrefix = '          '; // 10 spaces
            // Wait for BLE send to complete before proceeding
            await sendToBLE(spacePrefix + (line1 || ''), spacePrefix + (line2 || ''), {
              mac: BLE_MAC,
              scroll: true,
              scrollOnce: true,
              periodMs: 26,
              step: 2,
              align: 'center'
            });
            
            console.log(`   ✅ Weather message sent`);
            
            // Wait 2 seconds after weather message completes
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // Step 2: Send trading message (트레이딩 데이터) - only after weather is done
        if (group.trading) {
          let { line1, line2, finalDisplayText, messageType, timestamp } = group.trading;
          console.log(`   📈 Trading: ${messageType}`);
          
          // Adjust market message based on actual market status
          if (finalDisplayText) {
            finalDisplayText = adjustMarketMessage(finalDisplayText, timestamp || group.timestamp);
            const lines = finalDisplayText.split('\n');
            line1 = lines[0] || line1;
            line2 = lines[1] || line2;
          } else {
            line1 = adjustMarketMessage(line1, timestamp || group.timestamp);
            line2 = adjustMarketMessage(line2, timestamp || group.timestamp);
          }
          
          const spacePrefix = '          '; // 10 spaces
          // Wait for BLE send to complete before proceeding
          await sendToBLE(spacePrefix + (line1 || ''), spacePrefix + (line2 || ''), {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 26,
            step: 2,
            align: 'center'
          });
          
          console.log(`   ✅ Trading message sent`);
        } else if (lastTradeFallback) {
          // Fallback: Show last trade info in abbreviated format
          const { symbol, side, pnlPercent, reason } = lastTradeFallback;
          const sideLabel = side === 'long' ? 'LONG' : 'SHORT';
          const pnlStr = pnlPercent != null ? `${pnlPercent > 0 ? '+' : ''}${parseFloat(pnlPercent).toFixed(1)}%` : '—';
          const reasonStr = reason === 'take_profit' ? 'TP' : reason === 'stop_loss' ? 'SL' : reason === 'max_hold_time' ? 'TIME' : 'EXIT';
          
          const spacePrefix = '          '; // 10 spaces
          const line1 = `LAST TRADE: ${symbol} ${sideLabel}`;
          const line2 = `P/L ${pnlStr} ${reasonStr}`;
          
          console.log(`   📈 Trading (fallback): Last trade info`);
          
          // Wait for BLE send to complete
          await sendToBLE(spacePrefix + line1, spacePrefix + line2, {
            mac: BLE_MAC,
            scroll: true,
            scrollOnce: true,
            periodMs: 26,
            step: 2,
            align: 'center'
          });
          
          console.log(`   ✅ Trading fallback sent`);
        } else {
          console.log(`   ⚠️ No trading message available for this time slot`);
        }
        
        console.log(`   ✅ Sequence complete\n`);
      } catch (error) {
        console.error(`   ❌ Error sending message sequence:`, error.message);
        // Continue to next message
      }
    };

    console.log('🚀 Starting BLE transmission (1:1 time correspondence)...\n');
    console.log('   원본 1/5 KST 시간에 맞춰 1/6 KST 시간에 전송합니다.\n');
    sendNext();

    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error in sendBLEReplaySync:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  sendBLEReplaySync();
}

module.exports = { sendBLEReplaySync, sendToBLE };

