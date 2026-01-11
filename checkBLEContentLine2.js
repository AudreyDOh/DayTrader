/**
 * Check actual line2 format in BLE Content for specific times
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';

async function checkBLEContentLine2() {
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

    console.log(`\n📊 Checking BLE Content line2 format...\n`);

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
    const checkTimes = ['12:24', '12:34', '12:44', '12:54', '13:04'];
    
    console.log('📋 Checking ORDER entries at specific times:\n');
    
    for (const checkTime of checkTimes) {
      // Find STAGE 2 ORDER entries for this time
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const time = row[0] || '';
        const stage = row[1] || '';
        const type = row[2] || '';
        const line1 = row[3] || '';
        const line2 = row[4] || '';
        
        if (time === checkTime && stage === '2' && type === 'ORDER') {
          console.log(`   ${checkTime} EST:`);
          console.log(`      Line1: ${line1}`);
          console.log(`      Line2: ${line2}`);
          console.log(`      Has NKE: ${line2.includes('NKE')}`);
          console.log(`      Has LULU: ${line2.includes('LULU')}`);
          console.log('');
          break;
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContentLine2();

