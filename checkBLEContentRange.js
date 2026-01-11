/**
 * Check BLE Content time range vs Alpaca Trades
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';
const ALPACA_TRADES_SHEET = 'Alpaca Trades';

async function checkBLEContentRange() {
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

    console.log(`\n📊 Checking BLE Content range vs Alpaca Trades...\n`);

    // Read BLE Content
    const bleResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:F`
    });

    const bleRows = bleResponse.data.values || [];
    if (bleRows.length === 0) {
      console.log('❌ No data found in BLE Content sheet');
      return;
    }

    // Get time range from BLE Content
    const bleTimes = [];
    for (let i = 1; i < bleRows.length; i++) {
      const time = bleRows[i][0] || '';
      if (time && time.match(/^\d{1,2}:\d{2}$/)) {
        bleTimes.push(time);
      }
    }
    
    const uniqueBleTimes = [...new Set(bleTimes)].sort();
    const minBleTime = uniqueBleTimes[0];
    const maxBleTime = uniqueBleTimes[uniqueBleTimes.length - 1];
    
    console.log(`📊 BLE Content time range: ${minBleTime} - ${maxBleTime} EST`);
    console.log(`   Total entries: ${bleRows.length - 1}\n`);

    // Read Alpaca Trades
    const tradesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ALPACA_TRADES_SHEET}!A:K`
    });

    const tradesRows = tradesResponse.data.values || [];
    const dataRows = tradesRows.length > 1 ? tradesRows.slice(1) : tradesRows;
    
    // Get EST time range from Alpaca Trades
    const tradeTimes = [];
    for (const row of dataRows) {
      const tsMs = row[0];
      if (tsMs) {
        try {
          const date = new Date(parseInt(tsMs));
          const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const timeKey = `${String(estDate.getHours()).padStart(2, '0')}:${String(estDate.getMinutes()).padStart(2, '0')}`;
          const dateKey = `${estDate.getFullYear()}-${String(estDate.getMonth() + 1).padStart(2, '0')}-${String(estDate.getDate()).padStart(2, '0')}`;
          tradeTimes.push({ dateKey, timeKey, tsMs: parseInt(tsMs) });
        } catch (e) {
          // Skip invalid dates
        }
      }
    }
    
    // Group by date
    const tradesByDate = {};
    for (const t of tradeTimes) {
      if (!tradesByDate[t.dateKey]) {
        tradesByDate[t.dateKey] = [];
      }
      tradesByDate[t.dateKey].push(t.timeKey);
    }
    
    console.log(`📊 Alpaca Trades time ranges by date:\n`);
    for (const dateKey of Object.keys(tradesByDate).sort()) {
      const times = tradesByDate[dateKey];
      const uniqueTimes = [...new Set(times)].sort();
      const minTime = uniqueTimes[0];
      const maxTime = uniqueTimes[uniqueTimes.length - 1];
      console.log(`   ${dateKey}: ${minTime} - ${maxTime} EST (${times.length} trades)`);
    }
    console.log('');

    // Check for 2026-08-01 or 2026-01-08
    const targetDates = ['2026-08-01', '2026-01-08'];
    for (const targetDate of targetDates) {
      if (tradesByDate[targetDate]) {
        const times = tradesByDate[targetDate];
        const uniqueTimes = [...new Set(times)].sort();
        const minTime = uniqueTimes[0];
        const maxTime = uniqueTimes[uniqueTimes.length - 1];
        console.log(`📅 ${targetDate} trades: ${minTime} - ${maxTime} EST`);
        console.log(`   BLE Content range: ${minBleTime} - ${maxBleTime} EST`);
        
        const [maxHour, maxMin] = maxTime.split(':').map(Number);
        const maxTotalMin = maxHour * 60 + maxMin;
        const [bleMaxHour, bleMaxMin] = maxBleTime.split(':').map(Number);
        const bleMaxTotalMin = bleMaxHour * 60 + bleMaxMin;
        
        if (bleMaxTotalMin > maxTotalMin) {
          console.log(`   ⚠️  Mismatch: BLE Content extends ${Math.floor((bleMaxTotalMin - maxTotalMin) / 60)}h ${(bleMaxTotalMin - maxTotalMin) % 60}m beyond last trade`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContentRange();

