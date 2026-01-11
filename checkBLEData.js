require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = 'BLE Display';

async function checkBLEData() {
  try {
    await authorizeGoogleSheets();
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Read data for 1/7
    const targetDate = '2026-01-07';
    const [year, month, day] = targetDate.split('-').map(Number);
    const targetYear = year;
    const targetMonth = month - 1;
    const targetDay = day;

    console.log(`📖 Reading BLE Display data for ${targetDate}...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:AN`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    console.log(`✅ Found ${rows.length} rows (including header)\n`);

    // Show header
    if (rows.length > 0) {
      console.log('📋 Headers:');
      console.log(rows[0].slice(0, 15).join(' | '));
      console.log('');
    }

    // Filter for 1/7 data
    const filteredRows = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const timestamp = row[0];
      if (!timestamp) continue;

      let date;
      try {
        date = new Date(timestamp);
        if (isNaN(date.getTime())) continue;
      } catch (e) {
        continue;
      }

      // Check KST date
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const matchesKst = 
        kstDate.getFullYear() === targetYear &&
        kstDate.getMonth() === targetMonth &&
        kstDate.getDate() === targetDay;

      // Check EST date
      const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const matchesEst = 
        estDate.getFullYear() === targetYear &&
        estDate.getMonth() === targetMonth &&
        estDate.getDate() === targetDay;

      if (matchesKst || matchesEst) {
        filteredRows.push({
          rowIndex: i + 1,
          timestamp,
          kstDate: kstDate.toLocaleString('ko-KR'),
          estDate: estDate.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          messageType: row[1] || '',
          line1: row[2] || '',
          line2: row[3] || '',
          lux: row[5] || '',
          temperature: row[6] || '',
          humidity: row[7] || '',
          power: row[9] || '',
          mood: row[10] || '',
          stock1: row[11] || '',
          stock2: row[12] || '',
          positionSymbol: row[20] || '',
          positionSide: row[21] || '',
          exitSymbol: row[28] || ''
        });
      }
    }

    console.log(`📊 Found ${filteredRows.length} rows for ${targetDate}\n`);

    // Show samples around 1/7 EST 9:30-9:40 (market open time)
    console.log('🔍 Samples around 1/7 EST 9:30-9:40 (market open):\n');
    const samples = filteredRows.filter(r => {
      const est = new Date(r.timestamp);
      const estDate = new Date(est.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const estYear = estDate.getFullYear();
      const estMonth = estDate.getMonth();
      const estDay = estDate.getDate();
      const estHour = estDate.getHours();
      const estMinute = estDate.getMinutes();
      
      // 1/7 EST 9:30-9:40
      return estYear === 2026 && estMonth === 0 && estDay === 7 &&
             estHour === 9 && estMinute >= 30 && estMinute <= 40;
    });
    
    if (samples.length === 0) {
      console.log('⚠️ No data found for 1/7 EST 9:30-9:40');
      console.log('\n🔍 Checking 1/7 EST 9:00-10:00:\n');
      const samples2 = filteredRows.filter(r => {
        const est = new Date(r.timestamp);
        const estDate = new Date(est.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const estYear = estDate.getFullYear();
        const estMonth = estDate.getMonth();
        const estDay = estDate.getDate();
        const estHour = estDate.getHours();
        
        return estYear === 2026 && estMonth === 0 && estDay === 7 &&
               estHour === 9;
      });
      samples.push(...samples2.slice(0, 10));
    }

    if (samples.length === 0) {
      console.log('⚠️ No data found for 9:36-9:38 KST');
      // Show first 10 rows instead
      console.log('\n📋 First 10 rows:\n');
      filteredRows.slice(0, 10).forEach(r => {
        console.log(`Row ${r.rowIndex}:`);
        console.log(`  KST: ${r.kstDate}`);
        console.log(`  EST: ${r.estDate}`);
        console.log(`  Type: ${r.messageType}`);
        console.log(`  Line1: ${r.line1}`);
        console.log(`  Line2: ${r.line2}`);
        console.log(`  Sensor: Lux=${r.lux}, Temp=${r.temperature}, Hum=${r.humidity}, Power=${r.power}`);
        console.log(`  Mood: ${r.mood}, Stocks: ${r.stock1}, ${r.stock2}`);
        console.log(`  Position: ${r.positionSymbol} ${r.positionSide}`);
        console.log(`  Exit: ${r.exitSymbol}`);
        console.log('');
      });
    } else {
      samples.forEach(r => {
        console.log(`Row ${r.rowIndex}:`);
        console.log(`  KST: ${r.kstDate}`);
        console.log(`  EST: ${r.estDate}`);
        console.log(`  Type: ${r.messageType}`);
        console.log(`  Line1: ${r.line1}`);
        console.log(`  Line2: ${r.line2}`);
        console.log(`  Sensor: Lux=${r.lux}, Temp=${r.temperature}, Hum=${r.humidity}, Power=${r.power}`);
        console.log(`  Mood: ${r.mood}, Stocks: ${r.stock1}, ${r.stock2}`);
        console.log(`  Position: ${r.positionSymbol} ${r.positionSide}`);
        console.log(`  Exit: ${r.exitSymbol}`);
        console.log('');
      });
    }

    // Check for MARKET_CLOSED vs actual market hours
    console.log('\n📈 Market status check:\n');
    const marketClosedRows = filteredRows.filter(r => r.messageType === 'MARKET_CLOSED');
    const decisionRows = filteredRows.filter(r => r.messageType === 'DECISION');
    const positionRows = filteredRows.filter(r => r.messageType === 'POSITION');
    const exitRows = filteredRows.filter(r => r.messageType === 'EXIT');
    
    console.log(`  MARKET_CLOSED: ${marketClosedRows.length} rows`);
    console.log(`  DECISION: ${decisionRows.length} rows`);
    console.log(`  POSITION: ${positionRows.length} rows`);
    console.log(`  EXIT: ${exitRows.length} rows`);

    // Check MARKET_CLOSED rows during market hours (EST 9:30-16:00)
    const marketClosedDuringHours = marketClosedRows.filter(r => {
      const est = new Date(r.timestamp);
      const estDate = new Date(est.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = estDate.getHours();
      const minute = estDate.getMinutes();
      const isWeekday = estDate.getDay() !== 0 && estDate.getDay() !== 6;
      const isMarketHours = isWeekday && ((hour > 9 || (hour === 9 && minute >= 30)) && hour < 16);
      return isMarketHours;
    });

    if (marketClosedDuringHours.length > 0) {
      console.log(`\n⚠️ Found ${marketClosedDuringHours.length} MARKET_CLOSED rows during market hours (EST 9:30-16:00):`);
      marketClosedDuringHours.slice(0, 5).forEach(r => {
        console.log(`  Row ${r.rowIndex}: ${r.estDate} - ${r.line1} / ${r.line2}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  checkBLEData();
}

module.exports = { checkBLEData };

