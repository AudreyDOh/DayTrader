require('dotenv').config();
const Alpaca = require('@alpacahq/alpaca-trade-api');

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true // ✅ Make sure this is true
});

async function placeTestOrder() {
  try {
    const order = await alpaca.createOrder({
      symbol: 'AAPL',     // or any valid stock symbol
      qty: 1,
      side: 'buy',        // or 'sell'
      type: 'market',
      time_in_force: 'gtc'
    });

    const submittedAt = new Date(order.submitted_at).toLocaleString('en-US', {
      timeZone: 'America/New_York'
    });

    console.log(`✅ Order placed:
      - Symbol: ${order.symbol}
      - Qty: ${order.qty}
      - Side: ${order.side}
      - Status: ${order.status}
      - Submitted At: ${submittedAt}
    `);
  } catch (err) {
    console.error('❌ Failed to place order:', err.response?.data || err.message);
  }
}

placeTestOrder();
