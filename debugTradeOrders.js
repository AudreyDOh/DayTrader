/**
 * Debug trade orders to see what data we have
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { readTradesFromSheet } = require('./logToSheets');

async function debugTradeOrders() {
  try {
    await authorizeGoogleSheets();
    
    const dateArg = process.argv[2] || '2026-01-08';
    const [year, month, day] = dateArg.split('-').map(Number);
    
    console.log(`\n📊 Debugging trade orders for ${dateArg}...\n`);

    const trades = await readTradesFromSheet(1000, 'Alpaca Trades');
    
    const tradeOrders = [];
    for (const trade of trades) {
      const tradeDate = new Date(trade.tsMs || trade.tsIso || Date.now());
      const estDate = new Date(tradeDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      
      if (estDate.getFullYear() === year && 
          estDate.getMonth() === month - 1 && 
          estDate.getDate() === day) {
        const estHour = estDate.getHours();
        const estMinute = estDate.getMinutes();
        const totalMinutes = estHour * 60 + estMinute;
        const startMinutes = 9 * 60 + 30;
        
        if (totalMinutes >= startMinutes && trade.symbol && trade.entryPrice) {
          const timeKey = `${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')}`;
          tradeOrders.push({
            timeKey,
            estHour,
            estMinute,
            symbol: trade.symbol.toUpperCase(),
            side: trade.side === 'long' ? 'BUY' : 'SELL',
            entryPrice: trade.entryPrice,
            shares: trade.shares,
            timestamp: trade.tsIso || trade.tsLocal
          });
        }
      }
    }
    
    // Check 12:24
    const trades1224 = tradeOrders.filter(t => t.timeKey === '12:24');
    console.log(`\n📊 Trades at 12:24 (${trades1224.length}):\n`);
    for (const t of trades1224) {
      console.log(`   ${t.symbol} ${t.side} ${t.entryPrice} (${t.shares} shares)`);
    }
    
    // Check 12:34
    const trades1234 = tradeOrders.filter(t => t.timeKey === '12:34');
    console.log(`\n📊 Trades at 12:34 (${trades1234.length}):\n`);
    for (const t of trades1234) {
      console.log(`   ${t.symbol} ${t.side} ${t.entryPrice} (${t.shares} shares)`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

debugTradeOrders();

