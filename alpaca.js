/* 
Executes paper trading using solar data through Alpaca Paper Trading API
*/

require('dotenv').config();
const Alpaca = require('@alpacahq/alpaca-trade-api');

// (1) ===== CREATE ALPACA INSTANCE =====
const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true // ✅ Make sure this is true
});

  async function placeOrder(symbol, qty, side = 'buy') {
    try {
      const order = await alpaca.createOrder({
        symbol,
        qty,
        side,
        type: 'market',
        time_in_force: 'day'
      });
  
      const submittedAt = new Date(order.submitted_at).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour12: true
      });
  
      console.log(`✅ Order placed:
        - Symbol: ${order.symbol}
        - Qty: ${order.qty}
        - Side: ${order.side}
        - Status: ${order.status}
        - Submitted At: ${submittedAt}`);
      return order;
  
    } catch (error) {
      console.error('❌ Error placing order:', error.response?.data || error.message);
      throw error;
    }
  }
  
async function getLastQuote(symbol) {
  try {
    const quote = await alpaca.getLatestQuote(symbol);
    return {
      bidPrice: parseFloat(quote.Bp), 
      askPrice: parseFloat(quote.Ap)
    };
  } catch (error) {
    console.error(`❌ Error getting quote for ${symbol}:`, error.message);
    return null;
  }
}



  // ✅ Get recent bars for breakout detection
 // Updated getPreviousBars function to handle both data formats
async function getPreviousBars(symbol, limit = 5) {
  try {
    const bars = await alpaca.getBarsV2(
      symbol,
      { timeframe: '5Min', limit },
      alpaca.configuration
    );
    
    if (!bars) {
      console.error(`❌ No bar data returned for ${symbol}`);
      return null;
    }
    
    const result = [];
    
    for await (let bar of bars) {
      // Handle both new format (o, h, l, c) and old format (OpenPrice, HighPrice, etc.)
      if (bar) {
        // Check if using new format
        if (typeof bar.o === 'number' && typeof bar.c === 'number') {
          result.push({
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v || 0
          });
        } 
        // Check if using old format
        else if (typeof bar.OpenPrice === 'number' && typeof bar.ClosePrice === 'number') {
          result.push({
            open: bar.OpenPrice,
            high: bar.HighPrice,
            low: bar.LowPrice,
            close: bar.ClosePrice,
            volume: bar.Volume || 0
          });
        } else {
          console.warn(`⚠️ Invalid bar data for ${symbol}: ${JSON.stringify(bar)}`);
        }
      }
    }
    
    if (result.length === 0) {
      console.error(`❌ No valid bars found for ${symbol}`);
      return null;
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Error getting bars for ${symbol}:`, error.message);
    return null;
  }
}

  // ✅ Estimate volatility based on last 5 closes
  async function getVolatility(symbol) {
    try {
      const bars = await getPreviousBars(symbol, 5);
      
      if (!bars || bars.length === 0) {
        console.warn(`⚠️ No bars available for volatility calculation for ${symbol}`);
        return 0.03; // Return a default moderate volatility
      }
      
      const prices = bars.map(b => b.close);
      const avg = prices.reduce((a, b) => a + b) / prices.length;
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      return (high - low) / avg;
    } catch (error) {
      console.error(`❌ Error calculating volatility for ${symbol}:`, error.message);
      return 0.03; // Return a default moderate volatility on error
    }
  }
  
  // ✅ Account diagnostics
  async function getAccountInfo() {
    try {
      const account = await alpaca.getAccount();
      // Only log on first call or when explicitly needed
      if (!global.accountInfoLogged) {
        console.log(`💰 Account: Cash=$${account.cash}, Equity=$${account.equity}, Buying Power=$${account.buying_power}`);
        global.accountInfoLogged = true;
      }
      return account;
    } catch (err) {
      console.error('❌ Error fetching account info:', err.message);
    }
  }
  
  // ✅ Current positions
  async function getCurrentPositions() {
    try {
      const positions = await alpaca.getPositions();
      if (positions.length === 0) {
        console.log('📭 No current positions.');
      } else {
        console.log('📊 Current Holdings:');
        positions.forEach(pos => {
          console.log(`- ${pos.qty} shares of ${pos.symbol} @ $${pos.avg_entry_price}`);
        });
      }
      return positions;
    } catch (error) {
      console.error('❌ Error fetching positions:', error.response?.data || error.message);
    }
  }

  async function getBars(symbols, options) {
    try {
      const result = {};
      for (const symbol of symbols) {
        const bars = await alpaca.getBarsV2(
          symbol,
          { 
            timeframe: options.timeframe || '1Min',
            limit: options.limit || 5
          },
          alpaca.configuration
        );
        
        const barArray = [];
        for await (let bar of bars) {
          // Handle both formats
          if (bar) {
            if (typeof bar.o === 'number' && typeof bar.c === 'number') {
              barArray.push({
                t: bar.t,
                o: bar.o,
                h: bar.h,
                l: bar.l,
                c: bar.c,
                v: bar.v || 0
              });
            } else if (typeof bar.OpenPrice === 'number' && typeof bar.ClosePrice === 'number') {
              barArray.push({
                t: bar.Timestamp,
                o: bar.OpenPrice,
                h: bar.HighPrice,
                l: bar.LowPrice,
                c: bar.ClosePrice,
                v: bar.Volume || 0
              });
            }
          }
        }
        result[symbol] = barArray;
      }
      return result;
    } catch (error) {
      console.error(`Error getting bars: ${error.message}`);
      throw error;
    }
  }
  
module.exports = {
  alpaca,              
  placeOrder,
  getLastQuote,  // Add this back
  getBars, 
  getPreviousBars,
  getVolatility,
  getAccountInfo,
  getCurrentPositions
};
  

// // ===== PLACE A TEST ORDER =====
// async function placeTestOrder() {
  
//   try {
//     // Create a new order
//     const order = await alpaca.createOrder({ 
//       symbol: 'AAPL', // Apple Inc.
//       qty: 1, // Number of shares
//       side: 'buy', // buy or sell
//       type: 'market', 
//       time_in_force: 'gtc', 
//     });

//       // set time zone to New York
//   const submittedAt = new Date(order.submitted_at).toLocaleString('en-US', {
//     timeZone: 'America/New_York',
//     hour12: true
//   });

//     console.log(`✅ Order placed:
//       - Symbol: ${order.symbol}
//       - Qty: ${order.qty}
//       - Type: ${order.type}
//       - Side: ${order.side}
//       - Status: ${order.status}
//       - Submitted At (EST): ${submittedAt}
//     `);  } catch (error) {
//     console.error('❌ Error placing order:', error.response?.data || error.message);
//   }
// }
