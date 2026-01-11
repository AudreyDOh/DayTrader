/**
 * Check BLE Display line1 to see if LONG/SHORT is converted to BUY/SELL
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_DISPLAY_SHEET = 'BLE Display';

async function checkBLELine1() {
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

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_DISPLAY_SHEET}!A:E`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    const headerRow = rows[0];
    const messageTypeIdx = headerRow.indexOf('message_type');
    const line1Idx = headerRow.indexOf('line1');
    const line2Idx = headerRow.indexOf('line2');
    const positionSymbolIdx = headerRow.indexOf('position_symbol');

    console.log('\n📊 POSITION messages with line1:\n');
    
    for (let i = 1; i < Math.min(50, rows.length); i++) {
      const row = rows[i];
      const messageType = row[messageTypeIdx] || '';
      const line1 = row[line1Idx] || '';
      const line2 = row[line2Idx] || '';
      const symbol = row[positionSymbolIdx] || '';
      
      if (messageType === 'POSITION') {
        console.log(`   ${symbol}: Line1="${line1}" Line2="${line2}"`);
        console.log('');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkBLELine1();

