/**
 * Check if BLE Content is synced with Alpaca Trades
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const BLE_CONTENT_SHEET = 'BLE Content';
const ALPACA_TRADES_SHEET = 'Alpaca Trades';

async function checkBLEContentSync() {
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
    const [year, month, day] = dateArg.split('-').map(Number);
    
    console.log(`\n📊 Checking BLE Content sync with Alpaca Trades for ${dateArg}...\n`);

    // Read Alpaca Trades
    const tradesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ALPACA_TRADES_SHEET}!A:K`
    });

    const tradesRows = tradesResponse.data.values || [];
    const dataRows = tradesRows.length > 1 ? tradesRows.slice(1) : tradesRows;
    
    // Filter trades for target date (EST)
    const targetTrades = [];
    for (const row of dataRows) {
      const tsMs = row[0];
      if (tsMs) {
        try {
          const date = new Date(parseInt(tsMs));
          const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          if (estDate.getFullYear() === year && 
              estDate.getMonth() === month - 1 && 
              estDate.getDate() === day) {
            const estHour = estDate.getHours();
            const estMinute = estDate.getMinutes();
            const totalMinutes = estHour * 60 + estMinute;
            const startMinutes = 9 * 60 + 30;
            
            if (totalMinutes >= startMinutes) {
              const symbol = (row[3] || '').trim().toUpperCase();
              const side = (row[4] || '').trim();
              const entryPrice = parseFloat(row[5]) || 0;
              
              if (symbol && entryPrice > 0) {
                targetTrades.push({
                  timeKey: `${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')}`,
                  estHour,
                  estMinute,
                  symbol,
                  side,
                  entryPrice,
                  tsMs: parseInt(tsMs)
                });
              }
            }
          }
        } catch (e) {
          // Skip invalid dates
        }
      }
    }
    
    targetTrades.sort((a, b) => a.tsMs - b.tsMs);
    
    console.log(`✅ Found ${targetTrades.length} trades for ${dateArg} EST 9:30am onwards\n`);

    // Read BLE Content
    const bleResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BLE_CONTENT_SHEET}!A:F`
    });

    const bleRows = bleResponse.data.values || [];
    if (bleRows.length === 0) {
      console.log('❌ No data found in BLE Content sheet');
      return;
    }

    // Parse BLE Content (skip header)
    const bleContent = [];
    for (let i = 1; i < bleRows.length; i++) {
      const row = bleRows[i];
      const time = row[0] || '';
      const stage = row[1] || '';
      const type = row[2] || '';
      const line1 = row[3] || '';
      const line2 = row[4] || '';
      
      if (time && time.match(/^\d{1,2}:\d{2}$/)) {
        bleContent.push({ time, stage, type, line1, line2 });
      }
    }

    console.log(`✅ Found ${bleContent.length} entries in BLE Content\n`);

    // Check trades after 12:14
    const tradesAfter1214 = targetTrades.filter(t => {
      const totalMin = t.estHour * 60 + t.estMinute;
      return totalMin > (12 * 60 + 14);
    });

    console.log(`📊 Trades after 12:14 EST: ${tradesAfter1214.length}\n`);

    if (tradesAfter1214.length > 0) {
      console.log('🔍 Checking if these trades are reflected in BLE Content:\n');
      
      for (const trade of tradesAfter1214.slice(0, 10)) {
        const { timeKey, symbol, side, entryPrice } = trade;
        
        // Check STAGE 2 (ORDER/LAST_ORDER) entries for this time
        const bleEntries = bleContent.filter(b => 
          b.time === timeKey && b.stage === '2' && 
          (b.type === 'ORDER' || b.type === 'LAST_ORDER')
        );
        
        const found = bleEntries.some(b => 
          b.line2.includes(symbol) || b.line1.includes(symbol)
        );
        
        if (found) {
          console.log(`   ✅ ${timeKey}: ${symbol} ${side} ${entryPrice.toFixed(2)} - Found in BLE Content`);
        } else {
          console.log(`   ❌ ${timeKey}: ${symbol} ${side} ${entryPrice.toFixed(2)} - NOT found in BLE Content`);
          // Show what's actually in BLE Content for this time
          const actualEntries = bleContent.filter(b => b.time === timeKey && b.stage === '2');
          if (actualEntries.length > 0) {
            console.log(`      Actual: ${actualEntries[0].type} - ${actualEntries[0].line1} | ${actualEntries[0].line2}`);
          }
        }
      }
      
      if (tradesAfter1214.length > 10) {
        console.log(`   ... and ${tradesAfter1214.length - 10} more trades`);
      }
    } else {
      console.log('ℹ️  No trades after 12:14 EST');
    }

    // Summary
    const lastTrade = targetTrades[targetTrades.length - 1];
    if (lastTrade) {
      console.log(`\n📅 Last trade: ${lastTrade.timeKey} EST (${lastTrade.symbol} ${lastTrade.side})`);
    }
    
    const lastBLETime = bleContent.length > 0 ? bleContent[bleContent.length - 1].time : 'N/A';
    console.log(`📅 Last BLE Content entry: ${lastBLETime} EST\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkBLEContentSync();

