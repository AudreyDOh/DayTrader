
/* 
Logs all data here to Google Sheets
*/

const fs = require('fs');
const { google } = require('googleapis');

let sheetsClient; // reused after auth

const credentials = process.env.GOOGLE_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_CREDENTIALS) // use env variable for Render.com
  : require('./credentials.json');             // use local file for local dev

  
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

  const authClient = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });

  console.log('✅ Google Sheets authorized');
}

// Change this to match your sheet
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
