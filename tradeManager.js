/* 
Manage trading operations, including entry and exit signals, position sizing, and risk management.
Uses the Alpaca API to execute trades based on the signals generated from the solar sensors.
*/


// Access the required modules to handle trading operations and logging
const { getTPandSL } = require('./solarStrategy'); 
const { logToSheet } = require('./logToSheets');
// Access the Alpaca API for trading operations
const alpaca = require('./alpaca'); 

const TRADE_LOG_SHEET = 'Alpaca Trades';

// Define the TradeManager class to manage trading operations
// The constructor initializes the account balance and sets up arrays for open and closed trades
// The class also includes methods for evaluating trade entries, updating open trades, and closing trades

class TradeManager {
  // Constructor to initialize the TradeManager with an account balance
  constructor(accountBalance) {
    this.accountBalance = accountBalance; 
    this.openTrades = []; // Array to hold open trades
    this.closedTrades = []; // Array to hold closed trades
  }

  isValidSensorData(lux, temp, humidity) {
    return (
      typeof lux === 'number' && lux >= 0 &&
      typeof temp === 'number' && temp > -50 && temp < 150 &&
      typeof humidity === 'number' && humidity >= 0 && humidity <= 100
    );
  }

  async evaluateTradeEntry(symbol, mood, lux, temp, humidity) {
    try {
      if (!symbol || typeof symbol !== 'string') {
        return { executed: false, reason: 'Invalid symbol provided' };
      }

      if (!this.isValidSensorData(lux, temp, humidity)) {
        return { executed: false, reason: 'Invalid sensor data provided' };
      }

      const existingPosition = this.openTrades.find(trade => trade.symbol === symbol);
      if (existingPosition) {
        return { executed: false, reason: `Already have an open position in ${symbol}` };
      }

      const signal = await this.getEntrySignal(symbol);
      if (!signal) return { executed: false, reason: 'No valid entry signal (price/volume or bars)' };

      const { takeProfit, stopLoss } = require('./solarStrategy').getRiskProfile(lux);
      const maxHoldMinutes = require('./solarStrategy').getMaxHoldMinutes(humidity);

      const quote = await alpaca.getLastQuote(symbol);
      if (!quote || !quote.askPrice) {
        return { executed: false, reason: 'Could not retrieve valid quote data' };
      }

      const entryPrice = quote.askPrice;

      const volatility = await alpaca.getVolatility(symbol);
      const volatilityFactor = Math.min(volatility / 0.03, 1);

      const positionSize = require('./solarStrategy').getPositionSize(
        temp,
        this.accountBalance,
        entryPrice,
        stopLoss,
        volatilityFactor
      );

      const { takeProfit: tpPrice, stopLoss: slPrice } = getTPandSL(
        entryPrice,
        signal.side,
        takeProfit,
        stopLoss
      );

      await this.openTrade({
        symbol,
        side: signal.side,
        entryPrice,
        shares: positionSize,
        tpPrice,
        slPrice,
        entryTime: Date.now(),
        maxHoldMinutes,
        mood
      });

      return { executed: true };
    } catch (error) {
      console.error(`❌ Error evaluating trade entry for ${symbol}:`, error.message);
      return { executed: false, reason: `Error: ${error.message}` };
    }
  }

  async updateOpenTrades() {
    const now = Date.now();
    const tradesToClose = [];

    for (let i = 0; i < this.openTrades.length; i++) {
      const trade = this.openTrades[i];
      try {
        const current = await alpaca.getLastQuote(trade.symbol);
        if (!current || (!current.bidPrice && !current.askPrice)) {
          console.warn(`⚠️ Unable to get valid quote for ${trade.symbol}. Skipping update.`);
          continue;
        }

        const price = trade.side === 'long' ? current.bidPrice : current.askPrice;

        const hitTP = trade.side === 'long' ? price >= trade.tpPrice : price <= trade.tpPrice;
        const hitSL = trade.side === 'long' ? price <= trade.slPrice : price >= trade.slPrice;
        const ageMinutes = (now - trade.entryTime) / (60 * 1000);

        if (hitTP || hitSL || ageMinutes > trade.maxHoldMinutes) {
          tradesToClose.push({ trade, price, reason: hitTP ? 'TP' : hitSL ? 'SL' : 'TIME' });
        }
      } catch (error) {
        console.error(`❌ Error updating trade for ${trade.symbol}:`, error.message);
      }
    }

    for (const { trade, price, reason } of tradesToClose) {
      await this.closeTrade(trade, price, reason);
      this.openTrades = this.openTrades.filter(t =>
        t.symbol !== trade.symbol || t.entryTime !== trade.entryTime
      );
    }
  }

  async forceCloseAll() {
    const tradesToClose = [...this.openTrades];

    for (let trade of tradesToClose) {
      try {
        const current = await alpaca.getLastQuote(trade.symbol);
        const price = (current && (current.bidPrice || current.askPrice))
          ? (trade.side === 'long' ? current.bidPrice : current.askPrice)
          : trade.entryPrice;
        await this.closeTrade(trade, price, current ? 'FORCED' : 'FORCED_ERROR');
      } catch (error) {
        console.error(`❌ Error during force close for ${trade.symbol}:`, error.message);
        await this.closeTrade(trade, trade.entryPrice, 'FORCED_ERROR');
      }
    }
    this.openTrades = [];
  }

  async openTrade(trade) {
    console.log(`🚀 Open ${trade.side.toUpperCase()} trade: ${trade.symbol} @ ${trade.entryPrice} x${trade.shares}`);
    try {
      await alpaca.placeOrder(
        trade.symbol,
        trade.shares,
        trade.side === 'short' ? 'sell' : 'buy'
      );
      this.openTrades.push(trade);
    } catch (err) {
      console.error(`❌ Failed to place ${trade.side} order for ${trade.symbol}:`, err.message);
      throw err;
    }
  }

  async closeTrade(trade, exitPrice, reason) {
    console.log(`💸 Close ${trade.side.toUpperCase()} trade: ${trade.symbol} @ ${exitPrice} (${reason})`);
    const closedTrade = { ...trade, exitPrice, reason, exitTime: Date.now() };
    this.closedTrades.push(closedTrade);

    try {
      await alpaca.placeOrder(
        trade.symbol,
        trade.shares,
        trade.side === 'short' ? 'buy' : 'sell'
      );
    } catch (err) {
      console.error(`❌ Failed to close ${trade.side} trade for ${trade.symbol}:`, err.message);
    }

    try {
      await logToSheet([
        new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
        closedTrade.symbol,
        closedTrade.side,
        closedTrade.entryPrice,
        closedTrade.tpPrice,
        closedTrade.slPrice,
        exitPrice,
        reason,
        closedTrade.mood || 'Unknown'
      ], TRADE_LOG_SHEET);
    } catch (err) {
      console.error('❌ Failed to log trade to Google Sheets:', err.message);
    }
  }

  async getEntrySignal(symbol, loose = true) {
    try {
      const bars = await alpaca.getPreviousBars(symbol, 5);
      const current = await alpaca.getLastQuote(symbol);

      if (!bars || bars.length === 0) {
        console.warn(`⚠️ No bars returned for ${symbol}. Skipping entry signal.`);
        return null;
      }

      if (!current || !current.askPrice || !current.bidPrice) {
        console.warn(`⚠️ Invalid quote data for ${symbol}. Skipping entry signal.`);
        return null;
      }

      const prevHigh = Math.max(...bars.map(b => b.high));
      const prevLow = Math.min(...bars.map(b => b.low));
      const avgVolume = bars.reduce((acc, b) => acc + b.volume, 0) / bars.length;
      const currentVolume = bars[bars.length - 1].volume;

      const price = current.askPrice;
      const bid = current.bidPrice;

      const looseBreakoutBuffer = 0.99;
      const volumeThreshold = 1.02;

      console.log(`📊 [Signal Check] ${symbol} | Ask: ${price} | PrevHigh: ${prevHigh} | Bid: ${bid} | PrevLow: ${prevLow}`);
      console.log(`📉 [Volume Check] Volume: ${currentVolume} | AvgVol: ${avgVolume}`);

      if (price > prevHigh * looseBreakoutBuffer && currentVolume > volumeThreshold * avgVolume) {
        console.log(`✅ Signal detected for LONG entry on ${symbol}`);
        return { side: 'long' };
      }
      if (bid < prevLow * 1.01 && currentVolume > volumeThreshold * avgVolume) {
        console.log(`✅ Signal detected for SHORT entry on ${symbol}`);
        return { side: 'short' };
      }

      console.log(`⛔ No signal for ${symbol}.`);
      return null;
    } catch (error) {
      console.error(`❌ Error getting entry signal for ${symbol}:`, error.message);
      return null;
    }
  }
}

module.exports = TradeManager;
