#!/usr/bin/env node
/**
 * Debug script to check BLE Display sheet data
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = 'BLE Display';
let sheets = null;

async function debugBLEDisplay() {
  try {
    // Authorize
    console.log('🔐 Authorizing Google Sheets...');
    await authorizeGoogleSheets();
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    // Read all data
    console.log(`📖 Reading ${SHEET_NAME} sheet...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`
    });

    const rows = response.data.values || [];
    console.log(`✅ Found ${rows.length} total rows (including header)`);

    if (rows.length === 0) {
      console.log('❌ No data found in sheet');
      return;
    }

    // Show header
    if (rows.length > 0) {
      console.log('\n📋 Header row:');
      console.log(rows[0]);
    }

    // Show first 5 data rows
    console.log('\n📊 First 5 data rows:');
    for (let i = 1; i < Math.min(6, rows.length); i++) {
      const row = rows[i];
      const timestamp = row[0];
      const messageType = row[1];
      const line1 = row[2];
      const line2 = row[3];
      
      console.log(`\nRow ${i + 1}:`);
      console.log(`  timestamp: ${timestamp}`);
      console.log(`  message_type: ${messageType}`);
      console.log(`  line1: ${line1}`);
      console.log(`  line2: ${line2}`);
      
      // Try to parse timestamp
      if (timestamp) {
        try {
          const date = new Date(timestamp);
          const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          console.log(`  Parsed date (KST): ${kstDate.toLocaleString('ko-KR')}`);
          console.log(`  Year: ${kstDate.getFullYear()}, Month: ${kstDate.getMonth() + 1}, Day: ${kstDate.getDate()}`);
        } catch (e) {
          console.log(`  ❌ Error parsing timestamp: ${e.message}`);
        }
      }
    }

    // Check for 1/2/2026 data
    console.log('\n🔍 Checking for 1/2/2026 data...');
    const targetYear = 2026;
    const targetMonth = 0; // January (0-indexed)
    const targetDay = 2;

    let matchCount = 0;
    const dataRows = rows.slice(1); // Skip header
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const timestamp = row[0];
      
      if (!timestamp) continue;
      
      try {
        const date = new Date(timestamp);
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        
        const matches = 
          kstDate.getFullYear() === targetYear &&
          kstDate.getMonth() === targetMonth &&
          kstDate.getDate() === targetDay;
        
        if (matches) {
          matchCount++;
          if (matchCount <= 3) {
            console.log(`\n✅ Match ${matchCount}: Row ${i + 2}`);
            console.log(`   Timestamp: ${timestamp}`);
            console.log(`   KST Date: ${kstDate.toLocaleString('ko-KR')}`);
            console.log(`   Message: ${row[2]} / ${row[3]}`);
          }
        }
      } catch (e) {
        // Skip invalid timestamps
      }
    }

    console.log(`\n📊 Total matches for 1/2/2026: ${matchCount}`);

    // Show date range
    console.log('\n📅 Date range in sheet:');
    const dates = [];
    for (let i = 1; i < Math.min(100, rows.length); i++) {
      const timestamp = rows[i][0];
      if (timestamp) {
        try {
          const date = new Date(timestamp);
          const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          dates.push(kstDate);
        } catch (e) {
          // Skip
        }
      }
    }
    
    if (dates.length > 0) {
      dates.sort((a, b) => a.getTime() - b.getTime());
      console.log(`   Earliest: ${dates[0].toLocaleString('ko-KR')}`);
      console.log(`   Latest: ${dates[dates.length - 1].toLocaleString('ko-KR')}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

debugBLEDisplay();

