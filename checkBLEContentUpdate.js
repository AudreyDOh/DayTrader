/**
 * BLE Content가 9일 밤에 업데이트 되었는지 확인
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';
const BLE_DISPLAY_SHEET = 'BLE Display';

async function checkBLEContentUpdate() {
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
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    console.log('📅 현재 시간:');
    console.log(`   KST: ${kst.toLocaleString('ko-KR')}`);
    console.log(`   EST: ${est.toLocaleString('en-US')}\n`);
    
    // 1. BLE Content 시트 확인
    console.log('='.repeat(60));
    console.log('1️⃣ BLE Content 시트 확인');
    console.log('='.repeat(60));
    
    const contentResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:F`
    });
    
    const contentRows = contentResponse.data.values || [];
    if (contentRows.length === 0) {
      console.log('❌ BLE Content 시트에 데이터가 없습니다.');
      return;
    }
    
    console.log(`✅ BLE Content 시트에 ${contentRows.length}개 행이 있습니다.\n`);
    
    // 헤더 확인
    const headerRow = contentRows[0];
    console.log('📋 헤더:', headerRow.join(' | '));
    
    // 데이터 행 확인 (헤더 제외)
    const dataRows = contentRows.slice(1);
    if (dataRows.length > 0) {
      const firstDataRow = dataRows[0];
      const lastDataRow = dataRows[dataRows.length - 1];
      
      console.log(`\n📊 첫 번째 데이터 행:`, firstDataRow.join(' | '));
      console.log(`📊 마지막 데이터 행:`, lastDataRow.join(' | '));
      
      // EST_TIME 확인
      const estTimeIdx = headerRow.indexOf('EST_TIME');
      if (estTimeIdx >= 0) {
        const firstTime = firstDataRow[estTimeIdx];
        const lastTime = lastDataRow[estTimeIdx];
        console.log(`\n⏰ 시간 범위: ${firstTime} - ${lastTime} EST`);
      }
    }
    
    // 2. BLE Display 시트 확인 (9일 EST 데이터)
    console.log('\n' + '='.repeat(60));
    console.log('2️⃣ BLE Display 시트 확인 (9일 EST 데이터)');
    console.log('='.repeat(60));
    
    const displayResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_DISPLAY_SHEET}!A:AN`
    });
    
    const displayRows = displayResponse.data.values || [];
    if (displayRows.length === 0) {
      console.log('❌ BLE Display 시트에 데이터가 없습니다.');
      return;
    }
    
    console.log(`✅ BLE Display 시트에 ${displayRows.length}개 행이 있습니다.\n`);
    
    // 9일 EST 데이터 필터링
    const displayHeaderRow = displayRows[0];
    const timestampIdx = displayHeaderRow.indexOf('timestamp');
    
    if (timestampIdx < 0) {
      console.log('❌ timestamp 컬럼을 찾을 수 없습니다.');
      return;
    }
    
    const estYear = est.getFullYear();
    const estMonth = est.getMonth();
    const estDay = est.getDate();
    
    const est9Data = displayRows.slice(1).filter(row => {
      const timestamp = row[timestampIdx];
      if (!timestamp) return false;
      
      try {
        const date = new Date(timestamp);
        const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        return estDate.getFullYear() === estYear &&
               estDate.getMonth() === estMonth &&
               estDate.getDate() === estDay;
      } catch (e) {
        return false;
      }
    });
    
    console.log(`✅ 9일 EST 데이터: ${est9Data.length}개\n`);
    
    if (est9Data.length > 0) {
      const firstEst9 = new Date(est9Data[0][timestampIdx]);
      const lastEst9 = new Date(est9Data[est9Data.length - 1][timestampIdx]);
      const firstEst9Formatted = new Date(firstEst9.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const lastEst9Formatted = new Date(lastEst9.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      console.log(`   첫 데이터: ${firstEst9Formatted.toLocaleString('en-US')} EST`);
      console.log(`   마지막 데이터: ${lastEst9Formatted.toLocaleString('en-US')} EST`);
    }
    
    // 3. BLE Content가 9일 데이터를 포함하는지 확인
    console.log('\n' + '='.repeat(60));
    console.log('3️⃣ BLE Content가 9일 데이터를 포함하는지 확인');
    console.log('='.repeat(60));
    
    // BLE Content의 EST_TIME이 9일인지 확인
    const estTimeIdx2 = headerRow.indexOf('EST_TIME');
    if (estTimeIdx2 >= 0 && dataRows.length > 0) {
      // 첫 번째와 마지막 행의 시간 확인
      const firstTime = dataRows[0][estTimeIdx2];
      const lastTime = dataRows[dataRows.length - 1][estTimeIdx2];
      
      console.log(`\n📅 BLE Content 시간 범위: ${firstTime} - ${lastTime} EST`);
      
      // 9일인지 확인 (EST_TIME 형식: "9:30" 또는 "09:30")
      // BLE Content는 EST 시간만 저장하므로, 날짜는 generateBLEContent.js 실행 시점에 결정됨
      console.log(`\n💡 참고: BLE Content는 EST 시간만 저장합니다.`);
      console.log(`   날짜는 generateBLEContent.js 실행 시 인자로 전달된 날짜입니다.`);
      console.log(`   마지막 업데이트 확인을 위해 generateBLEContent.js 실행 로그를 확인하세요.`);
    }
    
    // 4. 결론
    console.log('\n' + '='.repeat(60));
    console.log('✅ 확인 완료');
    console.log('='.repeat(60));
    
    console.log(`\n📋 요약:`);
    console.log(`   - BLE Content 행 수: ${dataRows.length}개`);
    console.log(`   - BLE Display 9일 EST 데이터: ${est9Data.length}개`);
    console.log(`   - BLE Content 업데이트 여부: generateBLEContent.js 실행 로그 확인 필요`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContentUpdate();

