#!/usr/bin/env node
/**
 * Script to update rows 101-110 with same values as rows 99-100, but with time incremented by 1 minute each
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
let sheets = null;

async function updateRows101_110() {
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

    // Read rows 99-100 to get sample values
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Replay Feed!A99:J100'
    });

    const sampleRows = response.data.values || [];
    if (sampleRows.length < 2) {
      console.error('❌ Need at least 2 sample rows (99-100)');
      return;
    }

    console.log('📋 Sample rows 99-100 found');

    // Get the base timestamp from row 99
    const baseTsMs = parseInt(sampleRows[0][0]);
    const baseDate = new Date(baseTsMs);
    
    // Extract KST time from base timestamp
    const kstDateStr = baseDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
    const kstDate = new Date(kstDateStr);
    const targetYear = kstDate.getFullYear();
    const targetMonth = kstDate.getMonth();
    const targetDay = kstDate.getDate();
    const baseHour = kstDate.getHours();
    const baseMinute = kstDate.getMinutes();

    console.log(`📅 Base time: ${targetYear}-${targetMonth+1}-${targetDay} ${baseHour}:${String(baseMinute).padStart(2,'0')} KST`);

    // Use values from row 99 (or row 100 if row 99 doesn't have all values)
    const sampleRow = sampleRows[0].length >= 10 ? sampleRows[0] : sampleRows[1];
    
    const lux = parseFloat(sampleRow[3]) || 0;
    const temp = parseFloat(sampleRow[4]) || 0;
    const hum = parseFloat(sampleRow[5]) || 0;
    const current = parseFloat(sampleRow[6]) || 0;
    const power = parseFloat(sampleRow[7]) || 0;
    const battery = parseFloat(sampleRow[8]) || 0;
    const mood = sampleRow[9] || '—';

    console.log(`📊 Sample values: Lux=${lux}, Temp=${temp}, Power=${power}`);

    // Generate data for rows 101-110 (starting from baseHour:baseMinute + 2 minutes)
    const newRows = [];
    // Row 99 is at baseHour:baseMinute, Row 100 is at baseHour:baseMinute+1
    // So Row 101 should be at baseHour:baseMinute+2
    const startMinute = baseMinute + 2; // Row 101 starts 2 minutes after row 99

    for (let i = 0; i < 10; i++) {
      const minute = startMinute + i;
      const hour = baseHour + Math.floor(minute / 60);
      const finalMinute = minute % 60;

      // Create timestamp for the specified time (KST)
      // KST = UTC + 9 hours, so UTC = KST - 9 hours
      let utcHour = hour - 9;
      let utcDay = targetDay;
      let utcMonth = targetMonth;
      let utcYear = targetYear;
      
      if (utcHour < 0) {
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

    // Write to rows 101-110
    const startRow = 101;
    const range = `Replay Feed!A${startRow}:J${startRow + newRows.length - 1}`;
    
    console.log(`📝 Writing ${newRows.length} rows to ${range}...`);
    console.log(`   Time range: ${baseHour}:${String(startMinute).padStart(2,'0')} - ${Math.floor((startMinute + newRows.length - 1) / 60) + baseHour}:${String((startMinute + newRows.length - 1) % 60).padStart(2,'0')} KST`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: newRows
      }
    });

    console.log('✅ Successfully updated rows 101-110!');
    console.log(`   Updated ${newRows.length} rows with same values as row 99, time incremented by 1 minute each`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

updateRows101_110();

