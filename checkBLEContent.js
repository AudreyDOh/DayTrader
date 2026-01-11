/**
 * Check BLE Content sheet to see what messages will be sent
 * Usage: node checkBLEContent.js [date]
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';

async function checkBLEContent() {
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
    console.log(`\n📋 Checking BLE Content for ${dateArg} EST 9:30am onwards...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:E`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found in BLE Content sheet');
      return;
    }

    console.log(`✅ Found ${rows.length - 1} entries (excluding header)\n`);

    // Show first 30 entries
    console.log('📊 First 30 entries:\n');
    console.log('EST_TIME | STAGE | TYPE | LINE1 | LINE2');
    console.log('-'.repeat(120));
    
    for (let i = 1; i < Math.min(31, rows.length); i++) {
      const row = rows[i];
      const time = row[0] || '—';
      const stage = row[1] || '—';
      const type = row[2] || '—';
      const line1 = (row[3] || '—').substring(0, 35);
      const line2 = (row[4] || '—').substring(0, 40);
      
      console.log(`${time.padEnd(10)} | ${stage.padEnd(5)} | ${type.padEnd(15)} | ${line1.padEnd(35)} | ${line2}`);
    }
    
    if (rows.length > 31) {
      console.log(`\n... and ${rows.length - 31} more entries`);
    }
    
    // Count by message type (column 2 is MESSAGE_TYPE)
    const typeCount = {};
    const stage1Count = {};
    const stage2Count = {};
    for (let i = 1; i < rows.length; i++) {
      const stage = rows[i][1] || '—';
      const type = rows[i][2] || 'UNKNOWN';
      typeCount[type] = (typeCount[type] || 0) + 1;
      if (stage === '1') {
        stage1Count[type] = (stage1Count[type] || 0) + 1;
      } else if (stage === '2') {
        stage2Count[type] = (stage2Count[type] || 0) + 1;
      }
    }
    
    console.log('\n📊 Message type summary:');
    Object.entries(typeCount).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`   ${type.padEnd(20)}: ${count}`);
    });
    
    console.log('\n📊 STAGE 1 (기상 데이터) summary:');
    Object.entries(stage1Count).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`   ${type.padEnd(20)}: ${count}`);
    });
    
    console.log('\n📊 STAGE 2 (ORDER/포지션) summary:');
    Object.entries(stage2Count).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`   ${type.padEnd(20)}: ${count}`);
    });
    
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContent();

