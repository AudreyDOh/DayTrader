#!/usr/bin/env node
/**
 * Check BLE Display data for yesterday's trading and today's sensor data
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = 'BLE Display';
let sheets = null;

async function checkBLEData() {
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
    
    // Yesterday's trading (EST 1/4)
    const yesterdayEst = new Date(est);
    yesterdayEst.setDate(yesterdayEst.getDate() - 1);
    const yesterdayYear = yesterdayEst.getFullYear();
    const yesterdayMonth = yesterdayEst.getMonth();
    const yesterdayDay = yesterdayEst.getDate();
    
    // Today's sensor data (KST 1/5)
    const todayKstYear = kst.getFullYear();
    const todayKstMonth = kst.getMonth();
    const todayKstDay = kst.getDate();
    
    console.log('📅 날짜 확인:');
    console.log(`   어젯밤 트레이딩: ${yesterdayYear}-${String(yesterdayMonth + 1).padStart(2, '0')}-${String(yesterdayDay).padStart(2, '0')} (EST)`);
    console.log(`   오늘 기상 데이터: ${todayKstYear}-${String(todayKstMonth + 1).padStart(2, '0')}-${String(todayKstDay).padStart(2, '0')} (KST)\n`);
    
    // Read BLE Display data
    console.log('📖 Reading BLE Display data...\n');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found in BLE Display sheet');
      return;
    }

    const dataRows = rows.slice(1); // Skip header
    
    // Filter yesterday's trading data (EST)
    const yesterdayTrading = dataRows
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

        // Check EST date
        const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const matchesEstDate = 
          estDate.getFullYear() === yesterdayYear &&
          estDate.getMonth() === yesterdayMonth &&
          estDate.getDate() === yesterdayDay;

        // Also check UTC date
        const utcDate = new Date(timestamp);
        const matchesUtcDate = 
          utcDate.getFullYear() === yesterdayYear &&
          utcDate.getMonth() === yesterdayMonth &&
          utcDate.getDate() === yesterdayDay;

        if (!matchesEstDate && !matchesUtcDate) return null;

        return {
          timestamp,
          date: estDate,
          messageType,
          line1,
          line2,
          finalDisplayText,
          rowIndex: idx + 2
        };
      })
      .filter(item => item !== null)
      .filter(item => item.messageType === 'ORDER' || item.messageType === 'POSITION' || item.messageType === 'EXIT')
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Filter today's sensor data (KST)
    const todaySensor = dataRows
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

        // Check KST date
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const matchesKstDate = 
          kstDate.getFullYear() === todayKstYear &&
          kstDate.getMonth() === todayKstMonth &&
          kstDate.getDate() === todayKstDay;

        // Also check UTC date
        const utcDate = new Date(timestamp);
        const matchesUtcDate = 
          utcDate.getFullYear() === todayKstYear &&
          utcDate.getMonth() === todayKstMonth &&
          utcDate.getDate() === todayKstDay;

        if (!matchesKstDate && !matchesUtcDate) return null;

        return {
          timestamp,
          date: kstDate,
          messageType,
          line1,
          line2,
          finalDisplayText,
          rowIndex: idx + 2
        };
      })
      .filter(item => item !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    console.log(`📊 데이터 확인:`);
    console.log(`   어젯밤 트레이딩: ${yesterdayTrading.length}개 메시지`);
    console.log(`   오늘 기상 데이터: ${todaySensor.length}개 메시지\n`);

    if (yesterdayTrading.length > 0) {
      console.log(`📈 어젯밤 트레이딩 샘플 (처음 3개):`);
      yesterdayTrading.slice(0, 3).forEach((item, idx) => {
        console.log(`   ${idx + 1}. [${item.messageType}] ${item.date.toLocaleTimeString('ko-KR')}`);
        console.log(`      Line1: ${item.line1 || '—'}`);
        console.log(`      Line2: ${item.line2 || '—'}`);
      });
      console.log('');
    }

    if (todaySensor.length > 0) {
      console.log(`🌤️  오늘 기상 데이터 샘플 (처음 3개):`);
      todaySensor.slice(0, 3).forEach((item, idx) => {
        console.log(`   ${idx + 1}. [${item.messageType}] ${item.date.toLocaleTimeString('ko-KR')}`);
        console.log(`      Line1: ${item.line1 || '—'}`);
        console.log(`      Line2: ${item.line2 || '—'}`);
      });
      console.log('');
    }

    // Combine data
    const allData = [...yesterdayTrading, ...todaySensor].sort((a, b) => a.date.getTime() - b.date.getTime());
    
    console.log(`✅ 총 ${allData.length}개 메시지 준비 완료\n`);
    
    if (allData.length === 0) {
      console.log('⚠️ 전송할 데이터가 없습니다.');
      console.log('   BLE Display 시트에 데이터가 로깅되었는지 확인하세요.');
      return;
    }

    console.log('🚀 블루투스 전송 준비 완료!');
    console.log('   다음 명령어로 전송 시작:');
    console.log(`   node sendBLEScheduled.js --date 2026-01-04 --start 09:30 --end 17:30 --interval 1`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  checkBLEData();
}

module.exports = { checkBLEData };

