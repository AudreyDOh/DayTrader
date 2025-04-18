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
  
  // ✅ Get current bid/ask
  async function getLastQuote(symbol) {
    const quote = await alpaca.getLatestQuote(symbol);
    return {
      bidPrice: parseFloat(quote.Bp),
      askPrice: parseFloat(quote.Ap)
    };
  }
  
  // ✅ Get recent bars for breakout detection
  async function getPreviousBars(symbol, limit = 5) {
    const bars = await alpaca.getBarsV2(
      symbol,
      { timeframe: '5Min', limit },
      alpaca.configuration
    );
  
    const result = [];
    for await (let bar of bars) {
      result.push({
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v
      });
    }
    return result;
  }
  
  // ✅ Estimate volatility based on last 5 closes
  async function getVolatility(symbol) {
    const bars = await getPreviousBars(symbol, 5);
    const prices = bars.map(b => b.close);
    const avg = prices.reduce((a, b) => a + b) / prices.length;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    return (high - low) / avg;
  }
  
  // ✅ Account diagnostics
  async function getAccountInfo() {
    try {
      const account = await alpaca.getAccount();
      console.log(`💰 Account Info:
    - Cash: $${account.cash}
    - Equity: $${account.equity}
    - Buying Power: $${account.buying_power}
    - Positions Value: $${account.long_market_value}
    - Unrealized P/L: $${account.unrealized_pl}
    - Status: ${account.status}`);
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
  
  module.exports = {
    alpaca,              
    placeOrder,
    getLastQuote,
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
