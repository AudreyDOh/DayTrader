/* 
Manage trading operations, including entry and exit signals, position sizing, and risk management.
Uses the Alpaca API to execute trades based on the signals generated from the solar sensors.
*/


// Access the required modules to handle trading operations and logging
const { getTPandSL } = require('./solarStrategy');
const { logToSheet } = require('./logToSheets');
const alpaca = require('./alpaca'); // Access the Alpaca API for trading operations

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
    console.log(`💰 TradeManager initialized with account balance: $${this.accountBalance}`);
  }

  // Method to check if the sensor data is valid
  isValidSensorData(lux, temp, humidity) {
    return ( // Check if lux, temp, and humidity are numbers in valid ranges
      typeof lux === 'number' && lux >= -1 &&
      typeof temp === 'number' && temp > -50 && temp < 150 &&
      typeof humidity === 'number' && humidity >= 0 && humidity <= 100
    );
  }

  async evaluateTradeEntry(symbol, mood, lux, temp, humidity) {
    try {

      // Pulls target values from solarStrategy.js for takeProfit, stopLoss (lux) and maxHold (humidity)
      const { takeProfit, stopLoss } = require('./solarStrategy').getRiskProfile(lux);
      const maxHoldMinutes = require('./solarStrategy').getMaxHoldMinutes(humidity);

      // check if trade symbol exists as string 
      if (!symbol || typeof symbol !== 'string') {
        return { executed: false, reason: 'Invalid symbol provided' };
      }

      // check if sensor dat is valid
      if (!this.isValidSensorData(lux, temp, humidity)) {
        return { executed: false, reason: 'Invalid sensor data provided' };
      }
      
      // check if trade symbol is already doing a trade
      const existingPosition = this.openTrades.find(trade => trade.symbol === symbol);
      if (existingPosition) {
        return { executed: false, reason: `Already have an open position in ${symbol}` };
      }

      // check if there is valid entrysignal 
      const signal = await this.getEntrySignal(symbol);
      if (!signal) return { executed: false, reason: 'No valid entry signal (price/volume or bars)' };

      // Get the latest quote for the symbol stock, including "askPrice" and bidPrice"
      const quote = await alpaca.getLastQuote(symbol); 
      if (!quote || !quote.askPrice) { 
        return { executed: false, reason: 'Could not retrieve valid quote data' };
      } 
      const entryPrice = quote.askPrice; 
      const volatility = await alpaca.getVolatility(symbol); // Get the volatility of the stock
      const volatilityFactor = Math.min(volatility / 0.03, 1); 

      // HOW MUCH TO TRADE
      // Calculate the position size based on the account balance, entry price, stop loss, and volatility factor
      const positionSize = require('./solarStrategy').getPositionSize(
        temp,
        this.accountBalance,
        entryPrice,
        stopLoss,
        volatilityFactor
      );

      // WHEN TO GET OUT
      // uses getTPandSL function to calculate take profit and stop loss prices
      const { takeProfit: tpPrice, stopLoss: slPrice } = getTPandSL(
        entryPrice,
        signal.side,
        takeProfit,
        stopLoss
      );

      // calls openTrade function to execute the trade
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

      // return if the trade was executed successfully
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
      const bars = await alpaca.getPreviousBars(symbol, 5); // Get the last 5 bars for the symbol stock (5-minute trend)
      const current = await alpaca.getLastQuote(symbol); // Get the latest quote for the symbol stock

      // Basic data validation
      if (!bars || bars.length < 2 || !current?.askPrice || !current?.bidPrice) return null;

      // Calculate positive or negative trend based on latest closing price vs oldest closing price
      const closes = bars.map(b => b.close); // 
      const lastClose = closes[closes.length - 1]; // get the last closing price
      const firstClose = closes[0]; // get the first closing price
      // If last closing price is greater than first closing price, then it is an uptrend
      // If last closing price is less than first closing price, then it is a downtrend
      const trend = lastClose - firstClose; // + is uptrend, - is downtrend
      // const trendDirection = trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral';
      
      // Get the current and average volume of the last 5 bars
      const avgVolume = bars.reduce((sum, b) => sum + b.volume, 0) / bars.length;
      const lastVolume = bars[bars.length - 1].volume;
  
      const trendStrength = Math.abs(trend) > 0.1; // over $0.10 move counts as real, execute trade
      const volumeOkay = lastVolume > avgVolume * 0.5; // if the last volume is greater than 50% of the average volume, execute trae
  
      // if the trend is up and the volume is okay, make long entry
      if (trend > 0 && trendStrength && volumeOkay) {
        console.log(`✅ Signal detected for LONG entry on ${symbol}`);
        return { side: 'long' };
      }
        // if the trend is down and the volume is okay, make short entry
      if (trend < 0 && trendStrength && volumeOkay) {
        console.log(`✅ Signal detected for SHORT entry on ${symbol}`);
        return { side: 'short' };
      }
  
      // Make a loose signal check if the trend is not strong enough 
      // still make long and short entry 
      if (Math.abs(trend) >= 0.02) {
        return { side: trend > 0 ? 'long' : 'short' };
      }

      return null; // no movement at all -> skip
      console.log(`❌ No valid entry signal for ${symbol}`);
    } catch (error) {
      console.error(`❌ Error getting entry signal for ${symbol}:`, error.message);
      return null;
    }
  }
}

module.exports = TradeManager;
