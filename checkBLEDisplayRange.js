/**
 * Check BLE Display actual data range
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_DISPLAY_SHEET = 'BLE Display';

async function checkBLEDisplayRange() {
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

    const dateArg = process.argv[2] || '2026-01-08';
    const [year, month, day] = dateArg.split('-').map(Number);
    
    console.log(`\n📊 Checking BLE Display data range for ${dateArg}...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_DISPLAY_SHEET}!A:AN`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    const headerRow = rows[0];
    const timestampIdx = headerRow.indexOf('timestamp');
    const messageTypeIdx = headerRow.indexOf('message_type');
    const luxIdx = headerRow.indexOf('lux');

    const dataRows = rows.slice(1);
    const filteredData = [];
    
    for (const row of dataRows) {
      const timestamp = row[timestampIdx];
      if (!timestamp) continue;
      
      const date = new Date(timestamp);
      const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      if (estDate.getFullYear() === year && 
          estDate.getMonth() === month - 1 && 
          estDate.getDate() === day) {
        const estHour = estDate.getHours();
        const estMinute = estDate.getMinutes();
        const totalMinutes = estHour * 60 + estMinute;
        const startMinutes = 9 * 60 + 30;
        
        if (totalMinutes >= startMinutes) {
          const lux = row[luxIdx] || '';
          const messageType = row[messageTypeIdx] || '';
          filteredData.push({
            estHour,
            estMinute,
            timeKey: `${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')}`,
            messageType,
            hasLux: lux && lux !== '' && lux !== '0'
          });
        }
      }
    }

    console.log(`✅ Found ${filteredData.length} entries from EST 9:30am onwards\n`);

    // Group by hour to see data distribution
    const byHour = {};
    for (const d of filteredData) {
      if (!byHour[d.estHour]) {
        byHour[d.estHour] = { total: 0, withLux: 0 };
      }
      byHour[d.estHour].total++;
      if (d.hasLux) {
        byHour[d.estHour].withLux++;
      }
    }

    console.log('📊 Data distribution by hour (EST):\n');
    for (let hour = 9; hour <= 15; hour++) {
      const hourData = byHour[hour] || { total: 0, withLux: 0 };
      console.log(`   ${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59: ${hourData.total} entries (${hourData.withLux} with LUX data)`);
    }
    console.log('');

    // Find time range
    const times = filteredData.map(d => d.timeKey).sort();
    const minTime = times[0];
    const maxTime = times[times.length - 1];
    
    console.log(`📅 Actual data range: ${minTime} - ${maxTime} EST`);
    console.log(`   Total entries: ${filteredData.length}`);
    
    // Count entries with LUX data
    const withLux = filteredData.filter(d => d.hasLux).length;
    console.log(`   Entries with LUX data: ${withLux}`);
    console.log(`   Entries without LUX data: ${filteredData.length - withLux}\n`);

    // Check what happens around row 330 (which is around 2:30pm EST)
    // 330 rows = 165 minutes (each minute has 2 rows: STAGE 1 and 2)
    // 9:30am + 165 minutes = 12:15pm EST
    const row330Time = '12:15'; // Approximate
    console.log(`📌 Around row 330 (approx ${row330Time} EST):`);
    const around330 = filteredData.filter(d => {
      const dMin = d.estHour * 60 + d.estMinute;
      const targetMin = 12 * 60 + 15;
      return Math.abs(dMin - targetMin) <= 5;
    });
    console.log(`   Found ${around330.length} entries`);
    for (const d of around330.slice(0, 5)) {
      console.log(`   ${d.timeKey}: ${d.messageType} (LUX: ${d.hasLux ? 'YES' : 'NO'})`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEDisplayRange();

