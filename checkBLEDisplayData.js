/**
 * Check BLE Display data to see what positions are logged
 * Usage: node checkBLEDisplayData.js [date]
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_DISPLAY_SHEET = 'BLE Display';
const ALPACA_TRADES_SHEET = 'Alpaca Trades';

async function checkBLEDisplayData() {
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

    const dateArg = process.argv[2] || '2026-01-08';
    console.log(`\n📋 Checking BLE Display data for ${dateArg}...\n`);

    // Read BLE Display data
    const bleResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_DISPLAY_SHEET}!A:AN`
    });

    const bleRows = bleResponse.data.values || [];
    if (bleRows.length === 0) {
      console.log('❌ No data found in BLE Display sheet');
      return;
    }

    // Parse header
    const headerRow = bleRows[0];
    const timestampIdx = headerRow.indexOf('timestamp');
    const messageTypeIdx = headerRow.indexOf('message_type');
    const orderSymbolIdx = headerRow.indexOf('order_symbol');
    const positionSymbolIdx = headerRow.indexOf('position_symbol');
    const line1Idx = headerRow.indexOf('line1');
    const line2Idx = headerRow.indexOf('line2');

    // Filter data from EST 9:30am onwards
    const [year, month, day] = dateArg.split('-').map(Number);
    const dataRows = bleRows.slice(1);
    const filteredData = [];
    
    for (const row of dataRows) {
      const timestamp = row[timestampIdx];
      if (!timestamp) continue;
      
      const date = new Date(timestamp);
      const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      if (estDate.getFullYear() !== year || 
          estDate.getMonth() !== month - 1 || 
          estDate.getDate() !== day) {
        continue;
      }
      
      const estHour = estDate.getHours();
      const estMinute = estDate.getMinutes();
      const totalMinutes = estHour * 60 + estMinute;
      const startMinutes = 9 * 60 + 30;
      
      if (totalMinutes >= startMinutes) {
        filteredData.push({
          timestamp,
          estTime: `${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')}`,
          messageType: row[messageTypeIdx] || '',
          orderSymbol: row[orderSymbolIdx] || '',
          positionSymbol: row[positionSymbolIdx] || '',
          line1: row[line1Idx] || '',
          line2: row[line2Idx] || ''
        });
      }
    }

    console.log(`✅ Found ${filteredData.length} entries from EST 9:30am onwards\n`);

    // Check for ORDER and POSITION messages
    const orderMessages = filteredData.filter(d => d.messageType === 'ORDER' || d.messageType === 'ORDER_WEATHER');
    const positionMessages = filteredData.filter(d => d.messageType === 'POSITION');

    console.log('📊 ORDER messages:');
    const orderSymbols = new Set();
    orderMessages.forEach(msg => {
      const symbol = msg.orderSymbol || msg.positionSymbol || '—';
      if (symbol && symbol !== '—') orderSymbols.add(symbol);
      console.log(`   ${msg.estTime} | ${msg.messageType} | Symbol: ${symbol} | ${msg.line2.substring(0, 60)}`);
    });
    console.log(`\n   Unique symbols in ORDER: ${Array.from(orderSymbols).join(', ')}\n`);

    console.log('📊 POSITION messages:');
    const positionSymbols = new Set();
    positionMessages.forEach(msg => {
      const symbol = msg.positionSymbol || msg.orderSymbol || '—';
      if (symbol && symbol !== '—') positionSymbols.add(symbol);
      console.log(`   ${msg.estTime} | ${msg.messageType} | Symbol: ${symbol} | ${msg.line1.substring(0, 60)}`);
    });
    console.log(`\n   Unique symbols in POSITION: ${Array.from(positionSymbols).join(', ')}\n`);

    // Check Alpaca Trades
    console.log('📊 Checking Alpaca Trades...\n');
    try {
      const tradesResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ALPACA_TRADES_SHEET}!A:Z`
      });

      const tradesRows = tradesResponse.data.values || [];
      if (tradesRows.length > 0) {
        const tradesHeader = tradesRows[0];
        const symbolIdx = tradesHeader.indexOf('symbol') !== -1 ? tradesHeader.indexOf('symbol') : 
                         tradesHeader.indexOf('Symbol') !== -1 ? tradesHeader.indexOf('Symbol') : -1;
        
        if (symbolIdx !== -1) {
          const tradeSymbols = new Set();
          for (let i = 1; i < tradesRows.length; i++) {
            const symbol = tradesRows[i][symbolIdx];
            if (symbol && symbol.trim()) {
              tradeSymbols.add(symbol.trim().toUpperCase());
            }
          }
          console.log(`   Symbols in Alpaca Trades: ${Array.from(tradeSymbols).join(', ')}\n`);
          
          // Compare
          const missingInBLE = Array.from(tradeSymbols).filter(s => 
            !orderSymbols.has(s) && !positionSymbols.has(s)
          );
          if (missingInBLE.length > 0) {
            console.log(`⚠️  Symbols in Alpaca Trades but NOT in BLE Display: ${missingInBLE.join(', ')}\n`);
          }
        }
      }
    } catch (err) {
      console.log(`   Could not read Alpaca Trades: ${err.message}\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEDisplayData();

