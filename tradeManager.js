/*
Manage trading operations, including entry and exit signals, position sizing, and risk management.
Uses the Alpaca API to execute trades based on the signals generated from the solar sensors.
*/

const { getTPandSL } = require('./solarStrategy');
const { logToSheet } = require('./logToSheets');
const alpaca = require('./alpaca');

const TRADE_LOG_SHEET = 'Alpaca Trades';

class TradeManager {
  constructor(accountBalance) {
    this.accountBalance = accountBalance;
    this.openTrades = [];
    this.closedTrades = [];
  }

  // === Public ===

  async evaluateTradeEntry(symbol, mood, lux, temp, humidity) {
    console.log(`🔍 [evaluateTradeEntry] Evaluating: ${symbol} | Mood: ${mood} | Lux: ${lux} | Temp: ${temp} | Humidity: ${humidity}`);
    
    const signal = await this.getEntrySignal(symbol, true); // loosened entry
    if (!signal) {
      console.log(`❌ [evaluateTradeEntry] No valid entry signal for ${symbol}`);
      return { executed: false, reason: 'No breakout or low volume' };
    }

    const { takeProfit, stopLoss } = getTPandSL(symbol, lux, mood);

    const positionSize = Math.min(1, this.accountBalance * 0.01); // cap at 1% of account
    const qty = Math.floor(positionSize / signal.price);
    if (qty < 1) {
      console.log(`⚠️ [evaluateTradeEntry] Quantity too low to trade ${symbol}`);
      return { executed: false, reason: 'Position size too small' };
    }

    const order = {
      symbol,
      qty,
      side: 'buy',
      type: 'market',
      time_in_force: 'day'
    };

    try {
      console.log(`📤 [evaluateTradeEntry] Placing order: ${JSON.stringify(order)}`);
      const trade = await alpaca.createOrder(order);
      console.log(`✅ [evaluateTradeEntry] Order placed: ${trade.id}`);

      const timeNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      await logToSheet([
        timeNow,
        symbol,
        'BUY',
        `Qty: ${qty}`,
        lux,
        temp,
        humidity,
        mood,
        `TP: ${takeProfit}, SL: ${stopLoss}`
      ], TRADE_LOG_SHEET);

      this.openTrades.push({ symbol, qty, entry: signal.price, mood, time: Date.now() });

      return { executed: true, side: 'buy', price: signal.price };
    } catch (err) {
      console.error(`🚨 [evaluateTradeEntry] Order failed for ${symbol}:`, err.message);
      return { executed: false, reason: `Order failed: ${err.message}` };
    }
  }

  async getEntrySignal(symbol, loosened = false) {
    try {
      const bars = await alpaca.getBarsV2(symbol, {
        timeframe: '1Min',
        limit: 5
      });

      const barArray = [];
      for await (let b of bars) {
        barArray.push(b);
      }

      if (barArray.length < 2) return false;

      const latest = barArray[barArray.length - 1];
      const prev = barArray[barArray.length - 2];

      const volume = latest.volume;
      const avgVolume = (barArray.reduce((sum, b) => sum + b.volume, 0)) / barArray.length;

      const price = latest.close;
      const prevHigh = Math.max(...barArray.map(b => b.high));

      console.log(`📊 [getEntrySignal] ${symbol} | Price: ${price} | PrevHigh: ${prevHigh} | Volume: ${volume} | AvgVol: ${avgVolume}`);

      if (loosened) {
        if (volume < avgVolume * 1.2) return false;
        if (price < prevHigh * 1.001) return false;
      } else {
        if (volume < avgVolume * 2) return false;
        if (price < prevHigh * 1.01) return false;
      }

      return { price };
    } catch (err) {
      console.error(`🚨 [getEntrySignal] Failed to retrieve data for ${symbol}:`, err.message);
      return false;
    }
  }

  async forceCloseAll() {
    try {
      console.log('🔻 [forceCloseAll] Cancelling all open orders...');
      await alpaca.cancelAllOrders();
      const positions = await alpaca.getPositions();

      for (const pos of positions) {
        const side = pos.side === 'long' ? 'sell' : 'buy';
        const qty = Math.floor(Number(pos.qty));
        const symbol = pos.symbol;

        console.log(`🔄 [forceCloseAll] Closing ${side.toUpperCase()} position in ${symbol} (Qty: ${qty})`);
        await alpaca.createOrder({
          symbol,
          qty,
          side,
          type: 'market',
          time_in_force: 'day'
        });

        const timeNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
        await logToSheet([
          timeNow,
          symbol,
          side.toUpperCase(),
          `Force close`,
          '—', '—', '—',
          'Auto-Close',
          '—'
        ], TRADE_LOG_SHEET);
      }

      console.log('✅ [forceCloseAll] All positions closed.');
    } catch (err) {
      console.error('🚨 [forceCloseAll] Failed to close positions:', err.message);
    }
  }
}

module.exports = TradeManager;
