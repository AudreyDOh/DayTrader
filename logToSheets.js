/* 
Logs all data to Google Sheets
*/

const fs = require('fs');
const { google } = require('googleapis');

let sheetsClient; // reused after auth

async function authorizeGoogleSheets() {
  const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf-8');
  const credentials = JSON.parse(decoded);
  
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

// ✅ Accept optional sheet name argument
async function logToSheet(values, sheetName = 'DayTrader Log') {
  if (!sheetsClient) {
    console.error('❌ Sheets client not initialized. Call authorizeGoogleSheets() first.');
    return;
  }

  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });

    console.log(`📝 Logged to Google Sheets tab '${sheetName}'`);
  } catch (err) {
    console.error('❌ Failed to log to Google Sheets:', err.message);
  }
}

module.exports = {
  authorizeGoogleSheets,
  logToSheet,
};
