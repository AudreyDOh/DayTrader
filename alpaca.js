require('dotenv').config();
const Alpaca = require('@alpacahq/alpaca-trade-api');

// (1) ===== CREATE ALPACA INSTANCE =====
const alpaca = new Alpaca({
    keyId: process.env.ALPACA_API_KEY,
    secretKey: process.env.ALPACA_SECRET_KEY,
    paper: true,  // ✅ This must be true
  });

// ===== PLACE A TEST ORDER =====
async function placeTestOrder() {
  
  try {
    // Create a new order
    const order = await alpaca.createOrder({ 
      symbol: 'AAPL', // Apple Inc.
      qty: 1, // Number of shares
      side: 'buy', // buy or sell
      type: 'market', 
      time_in_force: 'gtc', 
    });

      // set time zone to New York
  const submittedAt = new Date(order.submitted_at).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: true
  });

    console.log(`✅ Order placed:
      - Symbol: ${order.symbol}
      - Qty: ${order.qty}
      - Type: ${order.type}
      - Side: ${order.side}
      - Status: ${order.status}
      - Submitted At (EST): ${submittedAt}
    `);  } catch (error) {
    console.error('❌ Error placing order:', error.response?.data || error.message);
  }
}

// ===== FETCH CURRENT HOLDINGS =====
async function getCurrentPositions() {
  try {
    const positions = await alpaca.getPositions();
    if (positions.length === 0) {
      console.log('📭 No current positions.');
    } else {
      console.log('📊 Current Holdings:');
      positions.forEach(pos => {
        console.log(`- ${pos.qty} shares of ${pos.symbol} at $${pos.avg_entry_price} avg price`);
      });
    }
  } catch (error) {
    console.error('❌ Error fetching positions:', error.response?.data || error.message);
  }
}

// ===== FETCH ACCOUNT INFO =====
async function getAccountInfo() {
    try {
      const account = await alpaca.getAccount();
      console.log(`💰 Account Info:
  - Cash: $${account.cash}
  - Equity: $${account.equity}
  - Buying Power: $${account.buying_power}
  - Positions Value: $${account.long_market_value}
  - Last Equity: $${account.last_equity}
  - Unrealized P/L: $${account.unrealized_pl}
  - Status: ${account.status}
      `);
    } catch (err) {
      console.error('❌ Error fetching account info:', err.message);
    }
  }
  

// (4) ===== RUN A FUNCTION BELOW =====
async function runAll() {
  await placeTestOrder();        // Wait for order to go through
  await getAccountInfo();        // Then check account
  await getCurrentPositions();   // Then check positions
}
runAll();  // <- Call the wrapper
