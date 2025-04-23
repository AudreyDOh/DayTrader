/* 
Manage trading operations, including entry and exit signals, position sizing, and risk management.
Uses the Alpaca API to execute trades based on the signals generated from the solar sensors.
*/

// Access the required modules to handle trading operations and logging
const { getTPandSL, getRiskProfile, getMaxHoldMinutes } = require('./solarStrategy');
// const { getTPandSL } = require('./solarStrategy');
const { logToSheet } = require('./logToSheets');
const alpaca = require('./alpaca'); // Access the Alpaca API for trading operations

const TRADE_LOG_SHEET = 'Alpaca Trades';

// Define the TradeManager class to manage trading operations
// The constructor initializes the account balance and sets up arrays for open and closed trades
// The class also includes methods for evaluating trade entries, updating open trades, and closing trades

class TradeManager {
  constructor(accountBalance) {
    this.accountBalance = accountBalance;
    this.openTrades = [];
    this.closedTrades = [];
    console.log(`💰 TradeManager initialized with account balance: $${this.accountBalance}`);
  }

  isValidSensorData(lux, temp, humidity) {
    return (
      typeof lux === 'number' && lux >= -1 &&
      typeof temp === 'number' && temp > -50 && temp < 150 &&
      typeof humidity === 'number' && humidity >= 0 && humidity <= 100
    );
  }

  async evaluateTradeEntry(symbol, mood, lux, temp, humidity) {
    try {
      const { takeProfit, stopLoss } = getRiskProfile(lux);
      const maxHoldMinutes = getMaxHoldMinutes(humidity);

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

      const quote = await alpaca.getLastQuote(symbol); 
      if (!quote || quote.askPrice == null) { 
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

  async getEntrySignal(symbol) {
    try {
      const bars = await alpaca.getPreviousBars(symbol, 5); // get last 5 bars for stock (open, high, low, close, volume)
      const current = await alpaca.getLastQuote(symbol); // get real-time price

      // check if bar data is valid
      if (!bars || bars.length < 2 || (current.askPrice == null && current.bidPrice == null)) {
        console.log(`❌ [${symbol}] Insufficient data: bars=${bars?.length || 0}, ask=${current?.askPrice}, bid=${current?.bidPrice}`);
        return null; // if missing, exit with null
      }

      const closes = bars.map(b => b?.close).filter(c => typeof c === 'number');
      if (closes.length < 2) {
        console.log(`❌ [${symbol}] Missing close data in bars. Skipping.`);
        return null;
      }

      // calculate trend and volume
      // Trend: Price difference between the last and first bar — shows relative change / overall direction.
      const trend = closes[closes.length - 1] - closes[0];
      // Volume: Average volume of the last 5 bars — shows market activity.
      // avgVolume: Average volume of the last 5 bars
      const avgVolume = bars.reduce((sum, b) => sum + (b.volume || 0), 0) / bars.length; // average volume over last 5 bars
      const lastVolume = bars[bars.length - 1]?.volume || 0; // most recent volume 

      // check if trend is significant, if not, fallback to random
      const minimalTrend = 0.005; // 0.5% change
      const trendUp = trend >= minimalTrend; // 0.5% increase
      const trendDown = trend <= -minimalTrend; // 0.5% decrease

      // Debug logging console.log(`🔍 [${symbol}] Entry Signal Evaluation`);
      console.log(`- Closes: ${closes.map(c => c !== undefined ? c.toFixed(2) : 'undefined').join(', ')}`);
      console.log(`- Trend: ${trend !== undefined ? trend.toFixed(4) : 'undefined'} (${trend > 0 ? 'Up' : 'Down'})`);
      console.log(`- Quote: Ask=${current.askPrice}, Bid=${current.bidPrice}`);

      // Enter Long
      if (trendUp) {
        console.log(`⚡ Minimal uptrend detected. Enter LONG for ${symbol}`);
        return { side: 'long' };
      }
      // Enter Short
      if (trendDown) {
        console.log(`⚡ Minimal downtrend detected. Enter SHORT for ${symbol}`);
        return { side: 'short' };
      }

      // Fallback Strategy: Randomly enter if no trend detected
      // This is a last resort to ensure some activity in the market
      if (current.askPrice || current.bidPrice) {
        const fallbackSide = Math.random() > 0.5 ? 'long' : 'short';
        console.log(`🤷 No trend. Randomly entering ${fallbackSide.toUpperCase()} for ${symbol}`);
        return { side: fallbackSide };
      }

      return null;
    } catch (error) {
      console.error(`❌ Error getting entry signal for ${symbol}:`, error.message);
      return null;
    }
  }
// Add this method to your TradeManager class
async updateOpenTrades() {
  try {
    if (this.openTrades.length === 0) {
      return { updated: true, message: 'No open trades to update' };
    }
    
    const alpaca = require('./alpaca'); // Make sure to import your alpaca module
    
    console.log(`🔄 Updating ${this.openTrades.length} open trade(s)...`);
    
    for (const trade of [...this.openTrades]) {
      const quote = await alpaca.getLastQuote(trade.symbol);
      if (!quote) {
        console.log(`⚠️ Could not get quote for ${trade.symbol}`);
        continue;
      }
      
      const currentPrice = trade.side === 'long' ? quote.bidPrice : quote.askPrice;
      const holdTime = (Date.now() - trade.entryTime) / (1000 * 60); // minutes
      
      // Check for take profit
      if ((trade.side === 'long' && currentPrice >= trade.tpPrice) || 
          (trade.side === 'short' && currentPrice <= trade.tpPrice)) {
        console.log(`🎯 Take profit hit for ${trade.symbol} at ${currentPrice}`);
        await this.closeTrade(trade, currentPrice, 'take_profit');
        continue;
      }
      
      // Check for stop loss
      if ((trade.side === 'long' && currentPrice <= trade.slPrice) || 
          (trade.side === 'short' && currentPrice >= trade.slPrice)) {
        console.log(`🛑 Stop loss hit for ${trade.symbol} at ${currentPrice}`);
        await this.closeTrade(trade, currentPrice, 'stop_loss');
        continue;
      }
      
      // Check for max hold time
      if (holdTime >= trade.maxHoldMinutes) {
        console.log(`⏱️ Max hold time reached for ${trade.symbol}`);
        await this.closeTrade(trade, currentPrice, 'max_hold_time');
        continue;
      }
    }
    
    return { updated: true, message: `Updated ${this.openTrades.length} open trades` };
  } catch (error) {
    console.error('❌ Error updating open trades:', error.message);
    return { updated: false, error: error.message };
  }
}

// You'll also need a closeTrade method if you don't have one already
async closeTrade(trade, exitPrice, reason) {
  try {
    const alpaca = require('./alpaca');
    
    // Calculate profit/loss
    const entryValue = trade.entryPrice * trade.shares;
    const exitValue = exitPrice * trade.shares;
    const pnl = trade.side === 'long' 
      ? exitValue - entryValue 
      : entryValue - exitValue;
    
    const pnlPercent = (pnl / entryValue * 100).toFixed(2);
    
    console.log(`💵 Closing ${trade.side} position in ${trade.symbol}:
      - Entry: $${trade.entryPrice} × ${trade.shares} shares
      - Exit: $${exitPrice}
      - P&L: $${pnl.toFixed(2)} (${pnlPercent}%)
      - Reason: ${reason}`);
    
    // Log the closed trade
    this.closedTrades.push({
      ...trade,
      exitPrice,
      exitTime: Date.now(),
      pnl,
      pnlPercent,
      reason
    });
    
    // Remove from open trades
    this.openTrades = this.openTrades.filter(t => t !== trade);
    
    // Log to Google sheets if you have that functionality
    const { logToSheet } = require('./logToSheets');
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    
    await logToSheet([
      now,
      trade.symbol,
      trade.side,
      trade.entryPrice,
      exitPrice,
      trade.shares,
      pnl.toFixed(2),
      pnlPercent,
      reason,
      (trade.exitTime - trade.entryTime) / (1000 * 60) // Hold time in minutes
    ], 'Alpaca Trades');
    
    return { closed: true };
  } catch (error) {
    console.error(`❌ Error closing trade for ${trade.symbol}:`, error.message);
    return { closed: false, error: error.message };
  }
}

// You might also need a forceCloseAll method that's referenced in your index.js
async forceCloseAll() {
  try {
    if (this.openTrades.length === 0) {
      console.log('📭 No open trades to close');
      return { closed: true, message: 'No open trades to close' };
    }
    
    console.log(`🚨 Force closing ${this.openTrades.length} open trade(s)...`);
    
    const alpaca = require('./alpaca');
    
    for (const trade of [...this.openTrades]) {
      const quote = await alpaca.getLastQuote(trade.symbol);
      if (!quote) continue;
      
      const currentPrice = trade.side === 'long' ? quote.bidPrice : quote.askPrice;
      await this.closeTrade(trade, currentPrice, 'market_close');
    }
    
    return { closed: true, message: 'All trades closed' };
  } catch (error) {
    console.error('❌ Error force closing all trades:', error.message);
    return { closed: false, error: error.message };
  }
}
  
}

module.exports = TradeManager;
