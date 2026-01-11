/**
 * BLE Content 9:30 행만 업데이트 (예시)
 * - 오늘(1/11 KST) 실시간 센서 데이터 사용
 * - Market closed 상태
 * - Last trade 정보
 * - Mood는 추천 주식만 (WATCH)
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed, readTradesFromSheet } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { createTickerMessages } = require('./tickerTape');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';

// Helper function to convert English text to uppercase
function toUpperCase(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/[a-z]+/g, (match) => match.toUpperCase());
}

// Determine mood from sensor data
function determineMood(sensor) {
  const WEATHER_THRESHOLDS = {
    BRIGHT_LUX: 20000,
    HOT_TEMP: 23,
    DRY_HUMIDITY: 50
  };
  
  const isBright = sensor.lux > WEATHER_THRESHOLDS.BRIGHT_LUX;
  const isHot = sensor.temperature > WEATHER_THRESHOLDS.HOT_TEMP;
  const isDry = sensor.humidity < WEATHER_THRESHOLDS.DRY_HUMIDITY;
  
  if (isBright && isDry && isHot) return 'Hot & Dry';
  if (isBright && isDry && !isHot) return 'Cold & Bright';
  if (isBright && !isDry) return 'Bright & Wet';
  if (!isBright && isDry) return 'Dry & Cloudy';
  if (!isBright && !isDry) return 'Dark & Wet';
  return 'Undecided';
}

// Get suggested stocks based on mood
function getSuggestedStocks(mood) {
  const moodStockMap = {
    "Bright & Dry": ["AAPL", "MSFT", "GOOG"],
    "Cold & Bright": ["IBM", "INTC"],
    "Hot & Dry": ["SPWR", "SEDG"],
    "Hot & Humid": ["MCD", "UBER"],
    "Dark & Wet": ["NEE", "ADIDAS"],
    "Dry & Cloudy": ["NKE", "LULU"],
    "Bright & Wet": ["NFLX", "DIS"],
    "Cold & Wet": ["TGT", "COST"]
  };
  return moodStockMap[mood] || [];
}

async function updateBLEContent930() {
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
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // 현재 시간
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayYear = kst.getFullYear();
    const todayMonth = kst.getMonth();
    const todayDay = kst.getDate();
    
    console.log(`📅 오늘 날짜: ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')} (KST)\n`);
    
    // 1. 오늘 KST 최신 센서 데이터 가져오기
    console.log('📖 Reading today\'s KST sensor data...\n');
    const allSensorData = await readReplayFeed(10000, 'Replay Feed');
    
    const todayData = allSensorData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return (
        itemKst.getFullYear() === todayYear &&
        itemKst.getMonth() === todayMonth &&
        itemKst.getDate() === todayDay
      );
    }).sort((a, b) => b.tsMs - a.tsMs); // 최신순
    
    if (todayData.length === 0) {
      console.log('❌ 오늘 KST 데이터가 없습니다!');
      return;
    }
    
    // 최신 센서 데이터 사용
    const latestSensor = todayData[0];
    console.log(`✅ 최신 센서 데이터: ${latestSensor.tsLocal}`);
    console.log(`   Lux=${latestSensor.lux}, Temp=${latestSensor.temperature}, Power=${latestSensor.power}\n`);
    
    // 2. Last trade 가져오기
    console.log('📖 Reading last trade...\n');
    const allTrades = await readTradesFromSheet(100, 'Alpaca Trades');
    const lastTrade = allTrades.length > 0 ? allTrades[allTrades.length - 1] : null;
    
    if (lastTrade) {
      console.log(`✅ Last trade: ${lastTrade.symbol} ${lastTrade.side} @ ${lastTrade.entryPrice}`);
      if (lastTrade.exitPrice) {
        console.log(`   Exit: ${lastTrade.exitPrice}, P/L: ${lastTrade.pnlPercent}%\n`);
      } else {
        console.log(`   (Active position)\n`);
      }
    } else {
      console.log('⚠️ No trades found\n');
    }
    
    // 3. Mood 및 추천 주식 결정
    const sensorObj = {
      lux: parseFloat(latestSensor.lux) || 0,
      temperature: parseFloat(latestSensor.temperature) || 0,
      humidity: parseFloat(latestSensor.humidity) || 0,
      current: parseFloat(latestSensor.current) || 0,
      power: parseFloat(latestSensor.power) || 0
    };
    
    const mood = determineMood(sensorObj);
    const suggestedStocks = getSuggestedStocks(mood);
    
    console.log(`📊 Mood: ${mood}`);
    console.log(`📈 Suggested stocks: ${suggestedStocks.join(', ')}\n`);
    
    // 4. Market closed 메시지 생성
    const market = { open: false };
    const messages = createTickerMessages({
      sensor: sensorObj,
      mood: mood,
      suggestedStocks: suggestedStocks,
      market: market,
      account: {}
    });
    
    const marketClosedMessage = messages[0] || '';
    const [line1, line2] = marketClosedMessage.split('\n');
    
    console.log('📋 Generated message:');
    console.log(`   Line1: ${line1}`);
    console.log(`   Line2: ${line2}\n`);
    
    // 5. Last trade 정보 포맷팅
    let lastTradeLine1 = '—';
    let lastTradeLine2 = '—';
    
    if (lastTrade) {
      const sideLabel = lastTrade.side === 'long' ? 'BUY' : 'SELL';
      const entryPrice = lastTrade.entryPrice ? parseFloat(lastTrade.entryPrice).toFixed(2) : '—';
      
      if (lastTrade.exitPrice) {
        // Closed trade
        const exitPrice = parseFloat(lastTrade.exitPrice).toFixed(2);
        const pnlStr = lastTrade.pnlPercent != null ? `${lastTrade.pnlPercent > 0 ? '+' : ''}${parseFloat(lastTrade.pnlPercent).toFixed(1)}%` : '—';
        lastTradeLine1 = toUpperCase(`LAST TRADE ${lastTrade.symbol} ${sideLabel} ${entryPrice} EXIT ${exitPrice}`);
        lastTradeLine2 = toUpperCase(`P/L ${pnlStr} ${lastTrade.reason || 'EXIT'}`);
      } else {
        // Active position
        const pnlStr = lastTrade.pnlPercent != null ? `${lastTrade.pnlPercent > 0 ? '+' : ''}${parseFloat(lastTrade.pnlPercent).toFixed(1)}%` : '—';
        lastTradeLine1 = toUpperCase(`LAST TRADE ${lastTrade.symbol} ${sideLabel} ${entryPrice} ACTIVE`);
        lastTradeLine2 = toUpperCase(`P/L ${pnlStr} OPEN POSITION`);
      }
    }
    
    // 6. BLE Content 읽기
    console.log('📖 Reading BLE Content...\n');
    const contentResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:F`
    });
    
    const contentRows = contentResponse.data.values || [];
    if (contentRows.length === 0) {
      console.log('❌ BLE Content 시트가 비어있습니다.');
      return;
    }
    
    // 7. 9:30 행 찾기 및 업데이트
    const headerRow = contentRows[0];
    const estTimeIdx = headerRow.indexOf('EST_TIME');
    const stageIdx = headerRow.indexOf('STAGE');
    const line1Idx = headerRow.indexOf('LINE1');
    const line2Idx = headerRow.indexOf('LINE2');
    
    let row930Stage1 = -1;
    let row930Stage2 = -1;
    
    for (let i = 1; i < contentRows.length; i++) {
      const row = contentRows[i];
      if (row[estTimeIdx] === '9:30' || row[estTimeIdx] === '09:30') {
        if (row[stageIdx] === '1') {
          row930Stage1 = i;
        } else if (row[stageIdx] === '2') {
          row930Stage2 = i;
        }
      }
    }
    
    if (row930Stage1 === -1 || row930Stage2 === -1) {
      console.log('❌ 9:30 행을 찾을 수 없습니다.');
      return;
    }
    
    console.log(`✅ 9:30 Stage 1 행: ${row930Stage1 + 1}`);
    console.log(`✅ 9:30 Stage 2 행: ${row930Stage2 + 1}\n`);
    
    // 8. 업데이트할 데이터 준비
    const updatedRows = [];
    
    // Stage 1: 기상 데이터 (Market closed)
    updatedRows.push({
      range: `${BLE_CONTENT_SHEET}!D${row930Stage1 + 1}:E${row930Stage1 + 1}`,
      values: [[toUpperCase(line1 || '—'), toUpperCase(line2 || '—')]]
    });
    
    // Stage 2: Last trade
    updatedRows.push({
      range: `${BLE_CONTENT_SHEET}!D${row930Stage2 + 1}:E${row930Stage2 + 1}`,
      values: [[lastTradeLine1, lastTradeLine2]]
    });
    
    // 9. 업데이트 실행
    console.log('📝 Updating BLE Content 9:30 rows...\n');
    
    for (const update of updatedRows) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: update.range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: update.values
        }
      });
    }
    
    console.log('✅ BLE Content 9:30 업데이트 완료!\n');
    console.log('📋 업데이트된 내용:');
    console.log(`   Stage 1 (기상): ${toUpperCase(line1)}`);
    console.log(`                  ${toUpperCase(line2)}`);
    console.log(`   Stage 2 (Last trade): ${lastTradeLine1}`);
    console.log(`                        ${lastTradeLine2}\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

updateBLEContent930();

