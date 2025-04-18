/* 
Logs all data to Google Sheets
*/

const fs = require('fs');
const { google } = require('googleapis');

let sheetsClient; // reused after auth

async function authorizeGoogleSheets() {
  const credentials = process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS) // Render.com
    : require('./credentials.json');             // Local dev

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient(); // ✅ moved inside the function
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });

  console.log('✅ Google Sheets authorized');
}

// === Sheet Settings ===
const SPREADSHEET_ID = '1eQTrdjEqDvpZx28d_Rb01BFQQEB1niOqbF4aBugZHk0';
const SHEET_NAME = 'DayTrader Log';

async function logToSheet(values) {
  if (!sheetsClient) {
    console.error('❌ Sheets client not initialized. Call authorizeGoogleSheets() first.');
    return;
  }

  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:I`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });

    console.log('📝 Logged to Google Sheets:', values);
  } catch (err) {
    console.error('❌ Failed to log to Google Sheets:', err.message);
  }
}

module.exports = {
  authorizeGoogleSheets,
  logToSheet,
};
