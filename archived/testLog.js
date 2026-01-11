const { authorizeGoogleSheets, logToSheet } = require('./logToSheets');

(async () => {
  await authorizeGoogleSheets();
  await logToSheet([
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    1234, // lux
    20,   // temperature
    50,   // humidity
    0.2,  // current
    1.1,  // power
    3.7,  // battery
    'Test Mood',
    'AAPL, TSLA'
  ]);
})();
