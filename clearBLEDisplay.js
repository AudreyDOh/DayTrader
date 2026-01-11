/**
 * Clear BLE Display sheet (keep headers only)
 * Usage: node clearBLEDisplay.js
 */

require('dotenv').config();
const { authorizeGoogleSheets, createBLEDisplaySheet } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = 'BLE Display';

async function clearBLEDisplay() {
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

    console.log(`\n🧹 Clearing BLE Display sheet...\n`);

    // First, check if sheet exists and get sheet ID
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });

    const targetSheet = spreadsheet.data.sheets?.find(
      sheet => sheet.properties.title === SHEET_NAME
    );

    if (!targetSheet) {
      console.log(`📋 Sheet "${SHEET_NAME}" does not exist. Creating it...`);
      await createBLEDisplaySheet(SHEET_NAME);
      console.log(`✅ BLE Display sheet initialized with headers only\n`);
      return;
    }

    const sheetId = targetSheet.properties.sheetId;

    // Get current data to check row count
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:AN`
    });

    const rows = response.data.values || [];
    const dataRowCount = rows.length > 1 ? rows.length - 1 : 0; // Exclude header

    if (dataRowCount === 0) {
      console.log(`✅ BLE Display sheet is already empty (only headers)`);
      return;
    }

    console.log(`📊 Found ${dataRowCount} data rows (excluding header)`);

    // Clear all data rows (keep header row)
    // Delete rows 2 to end (row 1 is header)
    if (rows.length > 1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: 1, // Start from row 2 (0-indexed, row 1 is header)
                endIndex: rows.length // Delete to end
              }
            }
          }]
        }
      });
      console.log(`✅ Deleted ${dataRowCount} data rows`);
    }

    // Ensure headers exist
    await createBLEDisplaySheet(SHEET_NAME);
    console.log(`✅ BLE Display sheet initialized (headers only)\n`);

  } catch (error) {
    console.error('❌ Error clearing BLE Display:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

clearBLEDisplay();

