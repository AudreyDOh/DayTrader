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
    this.openTrades = []; // multiple trades per symbol
    this.closedTrades = [];
  }

  // === Public ===

  async evaluateTradeEntry(symbol, mood, lux, temp, humidity) {
    const signal = await this.getEntrySignal(symbol, true); // loosened entry
    if (!signal) return { executed: false, reason: 'No breakout or low volume' };
  
    const { takeProfit, stopLoss } = require('./solarStrategy').getRiskProfile(lux);
    const maxHoldMinutes = require('./solarStrategy').getMaxHoldMinutes(humidity);
  
    const quote = await alpaca.getLastQuote(symbol);
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
  
    return { executed: true }; // ✅ Successful trade
  }
  

  async updateOpenTrades() {
    const now = Date.now();

    for (let i = this.openTrades.length - 1; i >= 0; i--) {
      const trade = this.openTrades[i];
      const current = await alpaca.getLastQuote(trade.symbol);
      const price = trade.side === 'long' ? current.bidPrice : current.askPrice;

      // Check TP/SL
      const hitTP = trade.side === 'long' ? price >= trade.tpPrice : price <= trade.tpPrice;
      const hitSL = trade.side === 'long' ? price <= trade.slPrice : price >= trade.slPrice;
      const ageMinutes = (now - trade.entryTime) / (60 * 1000);

      if (hitTP || hitSL || ageMinutes > trade.maxHoldMinutes) {
        await this.closeTrade(trade, price, hitTP ? 'TP' : hitSL ? 'SL' : 'TIME');
        this.openTrades.splice(i, 1);
      }
    }
  }

  async forceCloseAll() {
    for (let trade of this.openTrades) {
      const current = await alpaca.getLastQuote(trade.symbol);
      const price = trade.side === 'long' ? current.bidPrice : current.askPrice;
      await this.closeTrade(trade, price, 'FORCED');
    }
    this.openTrades = [];
  }

  // === Internal ===

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
        trade.side === 'short' ? 'buy' : 'sell' // closing a short = buy, long = sell
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
    const bars = await alpaca.getPreviousBars(symbol, 5);
    const current = await alpaca.getLastQuote(symbol);
  
    const prevHigh = Math.max(...bars.map(b => b.high));
    const prevLow = Math.min(...bars.map(b => b.low));
    const avgVolume = bars.reduce((acc, b) => acc + b.volume, 0) / bars.length;
    const currentVolume = bars[bars.length - 1].volume;
  
    const price = current.askPrice;
    const bid = current.bidPrice;
  
    const looseBreakoutBuffer = 0.995; // allows entry if price is just 0.5% below previous high
    const volumeThreshold = 1.1; // just 10% above average
  
    // Loosened breakout & volume logic
    if (price > prevHigh * looseBreakoutBuffer && currentVolume > volumeThreshold * avgVolume) {
      return { side: 'long' };
    }
    if (bid < prevLow * 1.005 && currentVolume > volumeThreshold * avgVolume) {
      return { side: 'short' };
    }
  
    return null;
  }
  
}

module.exports = TradeManager;