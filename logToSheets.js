/* 
Google Sheets integration for logging sensor data and trades
*/

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
let sheets = null;
let auth = null;

// Authorize Google Sheets API
async function authorizeGoogleSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS) {
      throw new Error('GOOGLE_CREDENTIALS environment variable not set');
    }

    let credentials;
    try {
      // Try parsing as JSON string first
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } catch (parseError) {
      // If parsing fails, try base64 decoding first
      try {
        const base64Decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8');
        credentials = JSON.parse(base64Decoded);
        console.log('✅ Google Sheets credentials decoded from base64');
      } catch (base64Error) {
        // If base64 decoding fails, try treating it as a file path
        if (process.env.GOOGLE_CREDENTIALS.startsWith('{')) {
          // It looks like JSON but parsing failed - rethrow
          throw new Error(`Invalid JSON in GOOGLE_CREDENTIALS: ${parseError.message}`);
        }
        // Try reading as file path
        const fs = require('fs');
        const path = require('path');
        const credPath = process.env.GOOGLE_CREDENTIALS.startsWith('/') 
          ? process.env.GOOGLE_CREDENTIALS 
          : path.join(process.cwd(), process.env.GOOGLE_CREDENTIALS);
        const credContent = fs.readFileSync(credPath, 'utf8');
        credentials = JSON.parse(credContent);
      }
    }
    auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log('✅ Google Sheets authorized');
    return true;
  } catch (error) {
    console.error('❌ Error authorizing Google Sheets:', error.message);
    throw error;
  }
}

// Log data to a specific sheet tab
async function logToSheet(values, sheetName = 'DayTrader Log') {
  if (!sheets || !SPREADSHEET_ID) {
    console.warn('⚠️ Google Sheets not configured');
    return;
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [values]
      }
    });
  } catch (error) {
    console.error('❌ Error logging to sheet:', error.message);
    throw error;
  }
}

// Read recent entries from a sheet
async function readRecentFromSheet(limit = 500, sheetName = 'DayTrader Log') {
  if (!sheets || !SPREADSHEET_ID) {
    console.warn('⚠️ Google Sheets not configured');
    return [];
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return [];

    // Skip header row if exists, then take last N rows
    const dataRows = rows.length > 1 && isHeaderRow(rows[0]) ? rows.slice(1) : rows;
    const recent = dataRows.slice(-limit).reverse(); // Most recent first

    // Convert to formatted objects
    return recent.map(row => {
      const timeStr = row[0] || '';
      const lux = parseFloat(row[1]) || 0;
      const temp = parseFloat(row[2]) || 0;
      const humidity = parseFloat(row[3]) || 0;
      const current = parseFloat(row[4]) || 0;
      const power = parseFloat(row[5]) || 0;
      const battery = parseFloat(row[6]) || 0;
      const mood = row[7] || '—';

      return {
        time: timeStr,
        date: timeStr.split(' ')[0] || '',
        timeStamp: new Date(timeStr).getTime() || Date.now(),
        temperature: temp,
        humidity: humidity,
        lux: lux,
        current: current,
        power: power,
        battery: battery,
        mood: mood
      };
    });
  } catch (error) {
    console.error('❌ Error reading from sheet:', error.message);
    return [];
  }
}

// Read replay feed data (with timestamp in milliseconds)
async function readReplayFeed(limit = 500, sheetName = 'Replay Feed') {
  if (!sheets || !SPREADSHEET_ID) {
    console.warn('⚠️ Google Sheets not configured');
    return [];
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return [];

    // Skip header row if exists
    const dataRows = rows.length > 1 && isHeaderRow(rows[0]) ? rows.slice(1) : rows;
    // If limit is very large (>= 5000), return all data to ensure we get target date
    const recent = limit >= 5000 ? dataRows : dataRows.slice(-limit);

    // Convert to replay format
    return recent.map(row => {
      const tsMs = parseInt(row[0]) || Date.now();
      const tsIso = row[1] || new Date(tsMs).toISOString();
      const tsLocal = row[2] || new Date(tsMs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      const lux = parseFloat(row[3]) || 0;
      const temp = parseFloat(row[4]) || 0;
      const humidity = parseFloat(row[5]) || 0;
      const current = parseFloat(row[6]) || 0;
      const power = parseFloat(row[7]) || 0;
      const battery = parseFloat(row[8]) || 0;
      const mood = row[9] || '—';

      return {
        tsMs,
        tsIso,
        tsLocal,
        lux,
        temperature: temp,
        humidity,
        current,
        power,
        battery,
        mood
      };
    }).filter(item => {
      // Filter out invalid entries: tsMs must be a valid timestamp (after year 2000)
      return item.tsMs > 946684800000 && item.tsMs < Date.now() + 86400000;
    });
  } catch (error) {
    console.error('❌ Error reading replay feed:', error.message);
    return [];
  }
}

// Read trades from sheet
async function readTradesFromSheet(limit = 300, sheetName = 'Alpaca Trades') {
  if (!sheets || !SPREADSHEET_ID) {
    console.warn('⚠️ Google Sheets not configured');
    return [];
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return [];

    // Skip header row if exists
    const dataRows = rows.length > 1 && isHeaderRow(rows[0]) ? rows.slice(1) : rows;
    const recent = dataRows.slice(-limit);

    // Convert to trade format
    return recent.map(row => {
      const tsMs = parseInt(row[0]) || Date.now();
      const tsIso = row[1] || new Date(tsMs).toISOString();
      const tsLocal = row[2] || new Date(tsMs).toLocaleString('en-US', { timeZone: 'America/New_York' });
      const symbol = row[3] || '';
      const side = row[4] || '';
      const entryPrice = parseFloat(row[5]) || 0;
      const exitPrice = parseFloat(row[6]) || 0;
      const shares = parseFloat(row[7]) || 0;
      const pnl = parseFloat(row[8]) || 0;
      const pnlPercent = parseFloat(row[9]) || 0;
      const reason = row[10] || '';

      return {
        tsMs,
        tsIso,
        tsLocal,
        symbol,
        side,
        entryPrice,
        exitPrice,
        shares,
        pnl,
        pnlPercent,
        reason
      };
    }).filter(item => item.tsMs > 0 && item.symbol); // Filter out invalid entries
  } catch (error) {
    console.error('❌ Error reading trades from sheet:', error.message);
    return [];
  }
}

// Helper function to detect header rows
function isHeaderRow(row) {
  if (!row || row.length === 0) return false;
  const firstCell = String(row[0]).toLowerCase();
  // Check for common header patterns
  const headerPatterns = ['time', 'timestamp', 'date', 'tsms', 'tsiso', 'tslocal'];
  if (headerPatterns.some(pattern => firstCell.includes(pattern))) {
    return true;
  }
  // Also check if first cell is not a number (likely a header)
  const firstCellNum = parseFloat(firstCell);
  if (isNaN(firstCellNum) || firstCellNum < 1000000000000) {
    // If it's not a valid timestamp (milliseconds), it might be a header
    // But also check if it looks like a header word
    if (firstCell.length < 20 && !firstCell.match(/^\d+$/)) {
      return true;
    }
  }
  return false;
}

// Create BLE Display sheet with headers
async function createBLEDisplaySheet(sheetName = 'BLE Display') {
  if (!sheets || !SPREADSHEET_ID) {
    console.warn('⚠️ Google Sheets not configured');
    return false;
  }

  try {
    // First, check if sheet exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });

    const existingSheet = spreadsheet.data.sheets?.find(
      sheet => sheet.properties.title === sheetName
    );

    if (existingSheet) {
      console.log(`📋 Sheet "${sheetName}" already exists`);
      // Check if headers exist
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:AN1`
      });

      if (response.data.values && response.data.values.length > 0) {
        console.log(`✅ Headers already exist in "${sheetName}"`);
        return true;
      }
    } else {
      // Create new sheet
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });
      console.log(`✅ Created new sheet "${sheetName}"`);
    }

    // Get sheet ID (refresh spreadsheet data after potential creation)
    const updatedSpreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    const targetSheet = updatedSpreadsheet.data.sheets?.find(
      sheet => sheet.properties.title === sheetName
    );
    
    if (!targetSheet) {
      throw new Error(`Failed to find or create sheet "${sheetName}"`);
    }
    const sheetId = targetSheet.properties.sheetId;

    // Define all column headers
    const headers = [
      // Common columns
      'timestamp',
      'message_type',
      'line1',
      'line2',
      'final_display_text',
      
      // Sensor data (DECISION, ORDER, MARKET_CLOSED)
      'lux',
      'temperature',
      'humidity',
      'current',
      'power',
      
      // Mood and suggested stocks (DECISION, MARKET_CLOSED)
      'mood',
      'suggested_stock_1',
      'suggested_stock_2',
      
      // Risk parameters (DECISION, ORDER)
      'risk_take_profit_pct',
      'risk_stop_loss_pct',
      'risk_hold_minutes',
      
      // Order information (ORDER)
      'order_side',
      'order_symbol',
      'order_size',
      'account_cash',
      
      // Position information (POSITION)
      'position_symbol',
      'position_side',
      'entry_price',
      'pnl_pct',
      'pnl_direction',
      'position_stop_loss_pct',
      'position_take_profit_pct',
      'position_size',
      'hold_minutes_left',
      'equity',
      
      // Exit information (EXIT)
      'exit_symbol',
      'exit_side',
      'exit_price',
      'exit_direction',
      'exit_reason',
      'exit_pnl_pct',
      'held_minutes',
      
      // Market information (MARKET_CLOSED)
      'next_open_hours',
      'next_open_minutes',
      'cooldown_minutes_left'
    ];

    // Add headers to sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [headers]
      }
    });

    // Format header row (bold, freeze first row)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          // Bold header row
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: headers.length
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true
                  },
                  backgroundColor: {
                    red: 0.9,
                    green: 0.9,
                    blue: 0.9
                  }
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)'
            }
          },
          // Freeze first row
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });

    console.log(`✅ Added ${headers.length} column headers to "${sheetName}"`);
    return true;
  } catch (error) {
    console.error('❌ Error creating BLE Display sheet:', error.message);
    throw error;
  }
}

// Log BLE Display data to sheet
async function logBLEDisplay(data) {
  if (!sheets || !SPREADSHEET_ID) {
    console.warn('⚠️ Google Sheets not configured');
    return;
  }

  try {
    // Map data object to array matching column order
    const values = [
      data.timestamp || new Date().toISOString(),
      data.message_type || '',
      data.line1 || '',
      data.line2 || '',
      data.final_display_text || '',
      // Sensor data
      data.lux ?? '',
      data.temperature ?? '',
      data.humidity ?? '',
      data.current ?? '',
      data.power ?? '',
      // Mood and stocks
      data.mood || '',
      data.suggested_stock_1 || '',
      data.suggested_stock_2 || '',
      // Risk parameters
      data.risk_take_profit_pct ?? '',
      data.risk_stop_loss_pct ?? '',
      data.risk_hold_minutes ?? '',
      // Order information
      data.order_side || '',
      data.order_symbol || '',
      data.order_size ?? '',
      data.account_cash ?? '',
      // Position information
      data.position_symbol || '',
      data.position_side || '',
      data.entry_price ?? '',
      data.pnl_pct ?? '',
      data.pnl_direction || '',
      data.position_stop_loss_pct ?? '',
      data.position_take_profit_pct ?? '',
      data.position_size ?? '',
      data.hold_minutes_left ?? '',
      data.equity ?? '',
      // Exit information
      data.exit_symbol || '',
      data.exit_side || '',
      data.exit_price ?? '',
      data.exit_direction || '',
      data.exit_reason || '',
      data.exit_pnl_pct ?? '',
      data.held_minutes ?? '',
      // Market information
      data.next_open_hours ?? '',
      data.next_open_minutes ?? '',
      data.cooldown_minutes_left ?? ''
    ];

    await logToSheet(values, 'BLE Display');
  } catch (error) {
    console.error('❌ Error logging BLE Display:', error.message);
    throw error;
  }
}

module.exports = {
  authorizeGoogleSheets,
  logToSheet,
  readRecentFromSheet,
  readReplayFeed,
  readTradesFromSheet,
  createBLEDisplaySheet,
  logBLEDisplay
};

