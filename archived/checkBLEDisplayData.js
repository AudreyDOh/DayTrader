#!/usr/bin/env node
/**
 * Check BLE Display data for debugging
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = 'BLE Display';
let sheets = null;

async function checkBLEDisplayData() {
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

    console.log(`✅ Total rows: ${rows.length}\n`);

    // Show first 10 rows
    console.log('📋 First 10 rows:');
    rows.slice(0, 10).forEach((row, idx) => {
      const timestamp = row[0];
      const messageType = row[1];
      const line1 = row[2];
      const line2 = row[3];
      
      if (timestamp) {
        try {
          const date = new Date(timestamp);
          const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          
          console.log(`\n[${idx + 1}]`);
          console.log(`   Timestamp: ${timestamp}`);
          console.log(`   KST: ${kstDate.toLocaleString('ko-KR')}`);
          console.log(`   EST: ${estDate.toLocaleString('en-US')}`);
          console.log(`   Type: ${messageType || '—'}`);
          console.log(`   Line1: ${line1 || '—'}`);
          console.log(`   Line2: ${line2 || '—'}`);
        } catch (e) {
          console.log(`\n[${idx + 1}] Invalid timestamp: ${timestamp}`);
        }
      }
    });

    // Check for 1/5 data
    console.log('\n\n🔍 Checking for 1/5 data...\n');
    const dataRows = rows.slice(1);
    const jan5Data = dataRows.filter(row => {
      const timestamp = row[0];
      if (!timestamp) return false;
      try {
        const date = new Date(timestamp);
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        
        // Check KST date
        const isJan5KST = kstDate.getFullYear() === 2026 && 
                          kstDate.getMonth() === 0 && 
                          kstDate.getDate() === 5;
        
        // Check EST date
        const isJan5EST = estDate.getFullYear() === 2026 && 
                          estDate.getMonth() === 0 && 
                          estDate.getDate() === 5;
        
        return isJan5KST || isJan5EST;
      } catch (e) {
        return false;
      }
    });

    console.log(`📊 Found ${jan5Data.length} rows for 1/5 (KST or EST)\n`);

    if (jan5Data.length > 0) {
      console.log('📋 Sample 1/5 data (first 5):');
      jan5Data.slice(0, 5).forEach((row, idx) => {
        const timestamp = row[0];
        const date = new Date(timestamp);
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        console.log(`\n[${idx + 1}] ${kstDate.toLocaleString('ko-KR')} - ${row[1] || '—'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  checkBLEDisplayData();
}

module.exports = { checkBLEDisplayData };

