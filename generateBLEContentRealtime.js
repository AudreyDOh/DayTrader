/**
 * Generate BLE Content with real-time sensor data
 * - 오늘(1/11 KST) 실시간 센서 데이터 사용
 * - Market closed 상태
 * - Last trade 정보
 * - Mood: Cold & Snowy (고정)
 * - 새로운 주식 추천
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

// Cold & Snowy mood에 대한 새로운 주식 추천
const COLD_SNOWY_STOCKS = ["COST", "WMT", "TGT", "HD", "LOW"]; // 겨울 필수품, 홈 개선

async function generateBLEContentRealtime() {
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
    
    // 1. 오늘 KST 센서 데이터 가져오기 (시간별로 매핑)
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
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    if (todayData.length === 0) {
      console.log('❌ 오늘 KST 데이터가 없습니다!');
      return;
    }
    
    console.log(`✅ 오늘 KST 데이터: ${todayData.length}개\n`);
    
    // 시간별로 센서 데이터 매핑 (hour:minute)
    const sensorByTime = new Map();
    for (const sensor of todayData) {
      const itemDate = new Date(sensor.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const hour = itemKst.getHours();
      const minute = itemKst.getMinutes();
      const timeKey = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      
      // 같은 시간에 여러 데이터가 있으면 최신 것 사용
      if (!sensorByTime.has(timeKey) || sensor.tsMs > sensorByTime.get(timeKey).tsMs) {
        sensorByTime.set(timeKey, sensor);
      }
    }
    
    // 최신 센서 데이터 (fallback용)
    const latestSensor = todayData[todayData.length - 1];
    
    // 2. Last trade 가져오기
    console.log('📖 Reading last trade...\n');
    const allTrades = await readTradesFromSheet(100, 'Alpaca Trades');
    const lastTrade = allTrades.length > 0 ? allTrades[allTrades.length - 1] : null;
    
    if (lastTrade) {
      console.log(`✅ Last trade: ${lastTrade.symbol} ${lastTrade.side} @ ${lastTrade.entryPrice}\n`);
    } else {
      console.log('⚠️ No trades found\n');
    }
    
    // 3. BLE Content 생성
    const bleContentRows = [];
    bleContentRows.push([
      'EST_TIME',
      'STAGE',
      'MESSAGE_TYPE',
      'LINE1',
      'LINE2',
      'DESCRIPTION'
    ]);
    
    // 4. 각 시간대별로 데이터 생성 (9:30 - 16:00)
    const startHour = 9;
    const startMinute = 30;
    const endHour = 16;
    const endMinute = 0;
    
    // Last trade 포맷팅
    let lastTradeLine1 = '—';
    let lastTradeLine2 = '—';
    
    if (lastTrade) {
      const sideLabel = lastTrade.side === 'long' ? 'BUY' : 'SELL';
      const entryPrice = lastTrade.entryPrice ? parseFloat(lastTrade.entryPrice).toFixed(2) : '—';
      
      if (lastTrade.exitPrice) {
        const exitPrice = parseFloat(lastTrade.exitPrice).toFixed(2);
        const pnlStr = lastTrade.pnlPercent != null ? `${lastTrade.pnlPercent > 0 ? '+' : ''}${parseFloat(lastTrade.pnlPercent).toFixed(1)}%` : '—';
        lastTradeLine1 = toUpperCase(`LAST TRADE ${lastTrade.symbol} ${sideLabel} ${entryPrice} EXIT ${exitPrice}`);
        lastTradeLine2 = toUpperCase(`P/L ${pnlStr} ${lastTrade.reason || 'EXIT'}`);
      } else {
        const pnlStr = lastTrade.pnlPercent != null ? `${lastTrade.pnlPercent > 0 ? '+' : ''}${parseFloat(lastTrade.pnlPercent).toFixed(1)}%` : '—';
        lastTradeLine1 = toUpperCase(`LAST TRADE ${lastTrade.symbol} ${sideLabel} ${entryPrice} ACTIVE`);
        lastTradeLine2 = toUpperCase(`P/L ${pnlStr} OPEN POSITION`);
      }
    }
    
    for (let hour = startHour; hour <= endHour; hour++) {
      const maxMinute = hour === endHour ? (endMinute === 0 ? 1 : endMinute + 1) : 60;
      const startMin = hour === startHour ? startMinute : 0;
      
      for (let minute = startMin; minute < maxMinute; minute++) {
        const timeKey = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        
        // 해당 시간의 센서 데이터 찾기 (KST 시간으로)
        // EST 9:30 → KST 9:30 데이터 사용
        const kstTimeKey = timeKey; // 같은 시간 사용
        let sensor = sensorByTime.get(kstTimeKey);
        
        // 정확한 시간이 없으면 근처 시간 데이터 사용 (5분 이내)
        if (!sensor) {
          for (let offset = -5; offset <= 5; offset++) {
            const checkMinute = minute + offset;
            if (checkMinute >= 0 && checkMinute < 60) {
              const checkHour = checkMinute < 0 ? hour - 1 : (checkMinute >= 60 ? hour + 1 : hour);
              if (checkHour >= 0 && checkHour < 24) {
                const checkKey = `${String(checkHour).padStart(2, '0')}:${String(checkMinute >= 0 ? checkMinute : checkMinute + 60).padStart(2, '0')}`;
                const checkSensor = sensorByTime.get(checkKey);
                if (checkSensor) {
                  sensor = checkSensor;
                  break;
                }
              }
            }
          }
        }
        
        // 여전히 없으면 최신 데이터 사용
        if (!sensor) {
          sensor = latestSensor;
        }
        
        // 센서 데이터 포맷팅
        const sensorObj = {
          lux: parseFloat(sensor.lux) || 0,
          temperature: parseFloat(sensor.temperature) || 0,
          humidity: parseFloat(sensor.humidity) || 0,
          current: parseFloat(sensor.current) || 0,
          power: parseFloat(sensor.power) || 0
        };
        
        // Market closed 메시지 생성 (Cold & Snowy mood, 새로운 주식 추천)
        const market = { open: false };
        const messages = createTickerMessages({
          sensor: sensorObj,
          mood: 'Cold & Snowy',
          suggestedStocks: COLD_SNOWY_STOCKS,
          market: market,
          account: {}
        });
        
        const marketClosedMessage = messages[0] || '';
        let [line1, line2] = marketClosedMessage.split('\n');
        
        // line2를 새로 생성하여 중복 방지
        const stocksStr = COLD_SNOWY_STOCKS.slice(0, 2).join(', ');
        line2 = `MARKET CLOSED NEXT 09:30ET MOOD COLD & SNOWY QUEUE ${stocksStr}`;
        
        // Stage 1: 기상 데이터
        bleContentRows.push([
          timeKey,
          '1',
          'WEATHER',
          toUpperCase(line1 || '—'),
          toUpperCase(line2 || '—'),
          '1단계: 기상 데이터 (실시간)'
        ]);
        
        // Stage 2: Last trade
        bleContentRows.push([
          timeKey,
          '2',
          lastTrade ? 'LAST_TRADE' : 'NO_DATA',
          lastTradeLine1,
          lastTradeLine2,
          lastTrade ? '2단계: 마지막 거래 정보' : '2단계: 거래 정보 없음'
        ]);
      }
    }
    
    // 5. BLE Content 시트 업데이트
    console.log('📝 Updating BLE Content sheet...\n');
    
    // 기존 데이터 지우기
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:Z`
    });
    
    // 새 데이터 쓰기
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: bleContentRows
      }
    });
    
    // 헤더 포맷팅
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const sheetId = spreadsheet.data.sheets?.find(
      sheet => sheet.properties.title === BLE_CONTENT_SHEET
    )?.properties.sheetId;
    
    if (sheetId) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 6
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
                  }
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)'
              }
            },
            {
              updateSheetProperties: {
                properties: {
                  sheetId: sheetId,
                  gridProperties: {
                    frozenRowCount: 1
                  }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            }
          ]
        }
      });
    }
    
    console.log(`✅ BLE Content 전체 업데이트 완료!\n`);
    console.log(`📋 Summary:`);
    console.log(`   - 총 ${bleContentRows.length - 1}개 행 생성`);
    console.log(`   - 시간 범위: EST 9:30am - 4:00pm`);
    console.log(`   - Mood: Cold & Snowy (고정)`);
    console.log(`   - 추천 주식: ${COLD_SNOWY_STOCKS.join(', ')}`);
    console.log(`   - Market: Closed`);
    console.log(`   - Last trade: ${lastTrade ? `${lastTrade.symbol} ${lastTrade.side}` : '없음'}\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

generateBLEContentRealtime();

