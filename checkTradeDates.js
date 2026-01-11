/**
 * Check Alpaca Trades dates and times to understand the mismatch
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const ALPACA_TRADES_SHEET = 'Alpaca Trades';

async function checkTradeDates() {
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

    console.log(`\n📊 Checking Alpaca Trades dates and times...\n`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ALPACA_TRADES_SHEET}!A:K`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    const dataRows = rows.length > 1 ? rows.slice(1) : rows;
    console.log(`✅ Found ${dataRows.length} trades\n`);
    
    // Get last 20 trades to see recent dates
    const recentTrades = dataRows.slice(-20);
    
    console.log('📋 Last 20 trades:\n');
    console.log('tsMs | tsIso | tsLocal | Symbol | Side | Entry | Exit');
    console.log('-'.repeat(100));
    
    for (const row of recentTrades) {
      const tsMs = row[0] || '';
      const tsIso = row[1] || '';
      const tsLocal = row[2] || '';
      const symbol = (row[3] || '').trim();
      const side = (row[4] || '').trim();
      const entryPrice = row[5] || '';
      const exitPrice = row[6] || '';
      
      if (symbol) {
        // Parse timestamp and convert to EST
        let estTime = '';
        if (tsMs) {
          try {
            const date = new Date(parseInt(tsMs));
            const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            estTime = `${estDate.getFullYear()}-${String(estDate.getMonth() + 1).padStart(2, '0')}-${String(estDate.getDate()).padStart(2, '0')} ${String(estDate.getHours()).padStart(2, '0')}:${String(estDate.getMinutes()).padStart(2, '0')}:${String(estDate.getSeconds()).padStart(2, '0')} EST`;
          } catch (e) {
            estTime = '—';
          }
        }
        
        console.log(`${tsMs.substring(0, 13)}... | ${tsIso.substring(0, 19)} | ${tsLocal.substring(0, 30)} | ${symbol.padEnd(6)} | ${side.padEnd(5)} | ${entryPrice.padEnd(8)} | ${exitPrice}`);
        console.log(`     EST: ${estTime}`);
        console.log('');
      }
    }
    
    // Group by date (EST)
    const tradesByDate = {};
    for (const row of dataRows) {
      const tsMs = row[0];
      const symbol = (row[3] || '').trim();
      if (tsMs && symbol) {
        try {
          const date = new Date(parseInt(tsMs));
          const estDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const dateKey = `${estDate.getFullYear()}-${String(estDate.getMonth() + 1).padStart(2, '0')}-${String(estDate.getDate()).padStart(2, '0')}`;
          
          if (!tradesByDate[dateKey]) {
            tradesByDate[dateKey] = [];
          }
          tradesByDate[dateKey].push({
            tsMs: parseInt(tsMs),
            symbol,
            estDate
          });
        } catch (e) {
          // Skip invalid dates
        }
      }
    }
    
    console.log('\n📅 Trades by date (EST):\n');
    for (const dateKey of Object.keys(tradesByDate).sort()) {
      const dateTrades = tradesByDate[dateKey];
      const times = dateTrades.map(t => {
        const h = t.estDate.getHours();
        const m = t.estDate.getMinutes();
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      });
      const minTime = times.length > 0 ? Math.min(...times.map(t => parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]))) : 0;
      const maxTime = times.length > 0 ? Math.max(...times.map(t => parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]))) : 0;
      const minTimeStr = `${String(Math.floor(minTime / 60)).padStart(2, '0')}:${String(minTime % 60).padStart(2, '0')}`;
      const maxTimeStr = `${String(Math.floor(maxTime / 60)).padStart(2, '0')}:${String(maxTime % 60).padStart(2, '0')}`;
      
      console.log(`   ${dateKey}: ${dateTrades.length} trades (${minTimeStr} - ${maxTimeStr} EST)`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkTradeDates();

