/**
 * Check if multiple rows are created for same time with multiple trades
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';

async function checkBLEContentMultipleRows() {
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

    console.log(`\n📊 Checking multiple rows for same time...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:F`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    // Check specific times where both NKE and LULU should be present
    const checkTimes = ['12:24', '12:34', '12:44'];
    
    console.log('📋 Checking rows for specific times:\n');
    
    for (const checkTime of checkTimes) {
      const rowsAtTime = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const time = row[0] || '';
        const stage = row[1] || '';
        const type = row[2] || '';
        const line2 = row[4] || '';
        
        if (time === checkTime) {
          rowsAtTime.push({ stage, type, line2 });
        }
      }
      
      console.log(`   ${checkTime} EST: ${rowsAtTime.length} rows`);
      for (const r of rowsAtTime) {
        const symbol = r.line2.includes('NKE') ? 'NKE' : (r.line2.includes('LULU') ? 'LULU' : '—');
        console.log(`      STAGE ${r.stage} ${r.type}: ${symbol}`);
      }
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContentMultipleRows();

