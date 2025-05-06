/* 
 The Intuition Converter: 
 This file will take solar sensor data and convert it into specific trading parameters for the current moment. 
*/


// Normalize any value between [min, max] → 0 to 1
function normalize(value, min, max) {
    return Math.min(Math.max((value - min) / (max - min), 0), 1);
  }

  // Lux value to risk profile (take profit and stop loss)
  // The brighter the day, the more aggressive and confident the trading strategy
  // The darker the day, the more conservative and cautious the trading strategy
  function getRiskProfile(lux) {
    const luxNorm = normalize(lux, 0, 50000); // Lux values set to between -1 and 50,000
    // Take Profit is set to X% of the stock price
    const takeProfit = parseFloat((4 + 4 * luxNorm).toFixed(2)); // 4–8% (means you are willing to gain 4% to 8% until you sell)
    // (1) CONSERVATIVE TP VER: const takeProfit = parseFloat((2.5 + 2 * luxNorm).toFixed(2));  // 2.5–4.5% (means you are willing to gain 2.5% to 4.5% until you sell)
     // (1) CONSERVATIVE SL VER: const stopLoss = parseFloat((1 + 1 * luxNorm).toFixed(2));       // 1–2%

    const stopLoss = parseFloat((2 + 2 * luxNorm).toFixed(2));    // 2–4%
    return { takeProfit, stopLoss };
    // Stop Loss is set to X% of the stock price (means you are willing to lose X% until you sell)
    return { takeProfit, stopLoss };
  }

  // Temperature value to trade volume
  // The hotter the day, the more shares you are willing to buy ( more heat - spending power )
  function getPositionSize(tempC, accountBalanceUSD, entryPrice, stopLossPct, volatilityFactor = 0.5) {
                                                                         // volatility-adjusted position sizing (0.5 benchmark)
    const tempNorm = normalize(tempC, 0, 40); // Temperature values set to between 0 and 40 degrees Celsius
    // Calculate the maximum risk per trade based on account balance and temperature
    const maxRiskPerTrade = accountBalanceUSD * 0.03 * tempNorm; // 0–1% of capital
    // Calculate the number of shares to buy based on entry price and stop loss percentage
    const perShareRisk = entryPrice * (stopLossPct / 100);
    // Calculate the number of shares to buy
    const rawShares = maxRiskPerTrade / perShareRisk;
    // volatility factor is a value between 0 and 1 that represents the volatility of the stock
    // current code takes 0.3 position of 
    const adjustedShares = Math.floor(rawShares * (1 - volatilityFactor)); // reduction of shares based on volatility
    return Math.max(1, adjustedShares); // Ensure at least 1 share is bought
  }

  // Humidity value to holding duration 
  // The more humid the day, the longer you are willing to hold the stock (sticky vs dry)
    // The drier the day, the more you want to sell quickly (dry vs sticky)
  function getMaxHoldMinutes(humidity) {
    const humidNorm = normalize(humidity, 0, 100); 
    return Math.floor(5 + humidNorm * 40); // 5–45 min
  }

  function shouldSkipDay(lux, humidity, temperature) {
    return lux < 200 && humidity > 80 && temperature < 7; // Too dark and humid
  }

  function getTPandSL(currentPrice, side, takeProfitPct, stopLossPct) {
    // Calculate take profit and stop loss prices based on side (long/short)
    if (side === 'long') {
      const takeProfit = currentPrice * (1 + takeProfitPct / 100);
      const stopLoss = currentPrice * (1 - stopLossPct / 100);
      return { takeProfit, stopLoss };
    } else { // side === 'short'
      const takeProfit = currentPrice * (1 - takeProfitPct / 100);
      const stopLoss = currentPrice * (1 + stopLossPct / 100);
      return { takeProfit, stopLoss };
    }
  }
  
// Update the module.exports in solarStrategy.js to include the new function
module.exports = {
  getRiskProfile,
  getPositionSize,
  getMaxHoldMinutes,
  shouldSkipDay,
  getTPandSL
};

