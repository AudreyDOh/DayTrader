/**
 * Check Alpaca Trades to see what symbols were actually traded
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const ALPACA_TRADES_SHEET = 'Alpaca Trades';

async function checkAlpacaTrades() {
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

    console.log(`\n📊 Checking Alpaca Trades...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ALPACA_TRADES_SHEET}!A:Z`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found in Alpaca Trades sheet');
      return;
    }

    // Alpaca Trades format: [tsMs, tsIso, tsLocal, symbol, side, entryPrice, exitPrice, shares, pnl, pnlPercent, reason]
    // Column indices: 0=tsMs, 1=tsIso, 2=tsLocal, 3=symbol, 4=side, 5=entryPrice, 6=exitPrice, 7=shares, 8=pnl, 9=pnlPercent, 10=reason
    
    const dataRows = rows.length > 1 ? rows.slice(1) : rows;
    console.log(`✅ Found ${dataRows.length} trades\n`);
    
    const trades = [];
    for (const row of dataRows) {
      const symbol = (row[3] || '').trim().toUpperCase();
      const side = (row[4] || '').trim();
      const timestamp = (row[2] || row[1] || row[0] || '').trim(); // tsLocal or tsIso or tsMs
      
      if (symbol) {
        trades.push({ symbol, side, timestamp, entryPrice: parseFloat(row[5]) || 0, exitPrice: parseFloat(row[6]) || 0 });
      }
    }
    
    const symbols = new Set(trades.map(t => t.symbol));
    console.log(`📊 Unique symbols traded: ${Array.from(symbols).join(', ')}\n`);
    
    console.log('📋 Trades by symbol:');
    for (const symbol of Array.from(symbols).sort()) {
      const symbolTrades = trades.filter(t => t.symbol === symbol);
      console.log(`   ${symbol}: ${symbolTrades.length} trades`);
      if (symbolTrades.length > 0 && symbolTrades[0].timestamp) {
        console.log(`      First: ${symbolTrades[0].timestamp}`);
        console.log(`      Last: ${symbolTrades[symbolTrades.length - 1].timestamp}`);
      }
    }
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkAlpacaTrades();

