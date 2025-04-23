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
      const bars = await alpaca.getPreviousBars(symbol, 5);
      const current = await alpaca.getLastQuote(symbol);

      if (!bars || bars.length < 2 || (current.askPrice == null && current.bidPrice == null)) {
        console.log(`❌ [${symbol}] Insufficient data: bars=${bars?.length || 0}, ask=${current?.askPrice}, bid=${current?.bidPrice}`);
        return null;
      }

      const closes = bars.map(b => b?.close).filter(c => typeof c === 'number');
      if (closes.length < 2) {
        console.log(`❌ [${symbol}] Missing close data in bars. Skipping.`);
        return null;
      }

      const trend = closes[closes.length - 1] - closes[0];

      const avgVolume = bars.reduce((sum, b) => sum + (b.volume || 0), 0) / bars.length;
      const lastVolume = bars[bars.length - 1]?.volume || 0;

      const minimalTrend = 0.005;
      const trendUp = trend >= minimalTrend;
      const trendDown = trend <= -minimalTrend;

      console.log(`🔍 [${symbol}] Entry Signal Evaluation`);
      console.log(`- Closes: ${closes.map(c => c?.toFixed(2)).join(', ')}`);
      console.log(`- Trend: ${trend?.toFixed(4)} (${trend > 0 ? 'Up' : 'Down'})`);
      console.log(`- Quote: Ask=${current.askPrice}, Bid=${current.bidPrice}`);

      if (trendUp) {
        console.log(`⚡ Minimal uptrend detected. Enter LONG for ${symbol}`);
        return { side: 'long' };
      }
      if (trendDown) {
        console.log(`⚡ Minimal downtrend detected. Enter SHORT for ${symbol}`);
        return { side: 'short' };
      }

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

  // (other methods unchanged)
}

module.exports = TradeManager;
