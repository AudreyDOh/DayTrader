#!/usr/bin/env node
/**
 * Script to fill rows 99-110 in Replay Feed sheet with data from 11:30 AM onwards (1/2/2026)
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
let sheets = null;

async function fillReplayData() {
  try {
    // Authorize
    await authorizeGoogleSheets();
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    // First, read existing data to get sample values
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Replay Feed!A1:J100'
    });

    const rows = response.data.values || [];
    console.log(`📊 Found ${rows.length} existing rows`);

    // Find a sample row to copy values from (skip header, use row with data)
    let sampleRow = null;
    for (let i = 1; i < rows.length && i < 50; i++) {
      if (rows[i] && rows[i].length >= 7 && rows[i][0] && !isNaN(parseInt(rows[i][0]))) {
        sampleRow = rows[i];
        break;
      }
    }

    if (!sampleRow) {
      console.error('❌ Could not find sample data row');
      return;
    }

    console.log('📋 Sample row found:', sampleRow.slice(0, 5));

    // Use 1/2/2026 as the target date
    const targetYear = 2026;
    const targetMonth = 0; // January (0-indexed)
    const targetDay = 2;

    // Generate data for 11:30 AM to 11:41 AM (12 rows: 99-110) in KST
    const newRows = [];
    const startHour = 11;
    const startMinute = 30;

    for (let i = 0; i < 12; i++) {
      const minute = startMinute + i;
      const hour = startHour + Math.floor(minute / 60);
      const finalMinute = minute % 60;

      // Create timestamp for 1/2/2026 at the specified time (KST)
      // Timestamps are stored as UTC milliseconds
      // KST = UTC + 9 hours, so UTC = KST - 9 hours
      // For 1/2 11:30 KST, we need 1/2 02:30 UTC
      let utcHour = hour - 9;
      let utcDay = targetDay;
      let utcMonth = targetMonth;
      let utcYear = targetYear;
      
      if (utcHour < 0) {
        // Previous day
        utcHour += 24;
        utcDay -= 1;
        if (utcDay < 1) {
          utcMonth -= 1;
          if (utcMonth < 0) {
            utcMonth = 11;
            utcYear -= 1;
          }
          utcDay = new Date(utcYear, utcMonth + 1, 0).getDate();
        }
      }
      
      // Create UTC date
      const utcDate = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHour, finalMinute, 0, 0));
      const tsMs = utcDate.getTime();
      const tsIso = new Date(tsMs).toISOString();
      const tsLocal = new Date(tsMs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      // Use values from sample row
      const lux = parseFloat(sampleRow[3]) || 0;
      const temp = parseFloat(sampleRow[4]) || 0;
      const hum = parseFloat(sampleRow[5]) || 0;
      const current = parseFloat(sampleRow[6]) || 0;
      const power = parseFloat(sampleRow[7]) || 0;
      const battery = parseFloat(sampleRow[8]) || 0;
      const mood = sampleRow[9] || '—';

      newRows.push([
        tsMs,
        tsIso,
        tsLocal,
        lux,
        temp,
        hum,
        current,
        power,
        battery,
        mood
      ]);
    }

    // Write to rows 99-110 (1-indexed, so row 99 = index 98)
    const startRow = 99;
    const range = `Replay Feed!A${startRow}:J${startRow + newRows.length - 1}`;
    
    console.log(`📝 Writing ${newRows.length} rows to ${range}...`);
    console.log(`   Time range: ${startHour}:${String(startMinute).padStart(2,'0')} - ${Math.floor((startMinute + newRows.length - 1) / 60) + startHour}:${String((startMinute + newRows.length - 1) % 60).padStart(2,'0')} KST`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: newRows
      }
    });

    console.log('✅ Successfully filled rows 99-110 with 1/2/2026 data!');
    console.log(`   Added ${newRows.length} rows from ${startHour}:${String(startMinute).padStart(2,'0')} to ${Math.floor((startMinute + newRows.length - 1) / 60) + startHour}:${String((startMinute + newRows.length - 1) % 60).padStart(2,'0')} KST`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fillReplayData();
