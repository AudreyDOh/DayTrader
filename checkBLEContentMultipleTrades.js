/**
 * Check if multiple trades at same time are displayed correctly in BLE Content
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';

async function checkBLEContentMultipleTrades() {
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

    console.log(`\n📊 Checking multiple trades at same time in BLE Content...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:F`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    // Find ORDER entries that might have multiple trades
    const orderEntries = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const time = row[0] || '';
      const stage = row[1] || '';
      const type = row[2] || '';
      const line2 = row[4] || '';
      
      if (stage === '2' && type === 'ORDER' && line2.includes('LIVE TRADING')) {
        // Check if line2 contains multiple symbols (NKE and LULU)
        const hasNKE = line2.includes('NKE');
        const hasLULU = line2.includes('LULU');
        
        if (hasNKE && hasLULU) {
          orderEntries.push({
            time,
            line2,
            hasBoth: true
          });
        } else if (hasNKE || hasLULU) {
          orderEntries.push({
            time,
            line2,
            hasBoth: false,
            hasNKE,
            hasLULU
          });
        }
      }
    }

    console.log(`✅ Found ${orderEntries.length} ORDER entries with NKE or LULU\n`);
    
    // Show entries with both NKE and LULU
    const bothEntries = orderEntries.filter(e => e.hasBoth);
    if (bothEntries.length > 0) {
      console.log(`📊 Entries with BOTH NKE and LULU (${bothEntries.length}):\n`);
      for (const entry of bothEntries.slice(0, 10)) {
        console.log(`   ${entry.time}: ${entry.line2}`);
      }
      if (bothEntries.length > 10) {
        console.log(`   ... and ${bothEntries.length - 10} more`);
      }
      console.log('');
    }
    
    // Show entries with only one symbol
    const singleEntries = orderEntries.filter(e => !e.hasBoth);
    if (singleEntries.length > 0) {
      console.log(`📊 Entries with ONLY ONE symbol (${singleEntries.length}):\n`);
      const nkeOnly = singleEntries.filter(e => e.hasNKE && !e.hasLULU);
      const luluOnly = singleEntries.filter(e => e.hasLULU && !e.hasNKE);
      
      if (nkeOnly.length > 0) {
        console.log(`   NKE only (${nkeOnly.length}):`);
        for (const entry of nkeOnly.slice(0, 5)) {
          console.log(`      ${entry.time}: ${entry.line2}`);
        }
        console.log('');
      }
      
      if (luluOnly.length > 0) {
        console.log(`   LULU only (${luluOnly.length}):`);
        for (const entry of luluOnly.slice(0, 5)) {
          console.log(`      ${entry.time}: ${entry.line2}`);
        }
        console.log('');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContentMultipleTrades();

