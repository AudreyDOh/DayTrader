/**
 * Check weather mood and suggested stocks for a specific date from Replay Feed
 * Usage: node checkWeatherMood.js [date] [time]
 * Example: node checkWeatherMood.js 2026-01-08 09:30
 */

const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

const moodStockMap = {
  "Bright & Dry": ["MSFT", "GOOG"],
  "Cold & Bright": ["INTC", "IBM"],
  "Hot & Dry": ["SPWR", "SEDG"],
  "Hot & Humid": ["DASH", "UBER"],
  "Dark & Wet": ["NEE", "WM"],
  "Dry & Cloudy": ["NKE", "LULU"],
  "Bright & Wet": ["NKE", "LULU"],
  "Cold & Wet": ["TGT", "COST"]
};

const moodNameMap = {
  "Bright & Dry": "Golden Clarity (아지랑이)",
  "Dark & Wet": "Black Rain (그런 날도 있는거다)",
  "Cold & Bright": "Crispy Breeze (여름이었ㄷr..)",
  "Hot & Humid": "Hazy Surge (눈 찌르는 무더위)",
  "Cold & Wet": "Still Waters (이슬비가 내리는 날이면)",
  "Hot & Dry": "Rising Sun (TVXQ)",
  "Dry & Cloudy": "Wind Cries Mary (장미꽃 향기는 바람에 날리고)",
  "Bright & Wet": "Sunshower (여우비)"
};

// Weather condition thresholds (adjust these values to change hot/cold/dry/wet/bright thresholds)
const WEATHER_THRESHOLDS = {
  BRIGHT_LUX: 20000,        // Lux > this value = Bright, <= this value = Dark
  HOT_TEMP: 15,              // Temperature > this value = Hot, <= this value = Cold
  DRY_HUMIDITY: 50           // Humidity < this value = Dry, >= this value = Wet
};

function determineTradeMood({ lux, temperature, humidity }) {
  const isBright = lux > WEATHER_THRESHOLDS.BRIGHT_LUX;
  const isHot = temperature > WEATHER_THRESHOLDS.HOT_TEMP;
  const isDry = humidity < WEATHER_THRESHOLDS.DRY_HUMIDITY;
  
  if (isBright && isDry && isHot) return "Hot & Dry";
  if (isBright && isDry) return "Bright & Dry";
  if (isBright && !isDry) return "Bright & Wet";
  if (!isBright && isDry) return "Dry & Cloudy";
  if (!isBright && !isDry && temperature <= WEATHER_THRESHOLDS.HOT_TEMP) return "Cold & Wet";
  if (!isBright && !isDry && temperature > WEATHER_THRESHOLDS.HOT_TEMP) return "Hot & Humid";
  if (isBright && !isDry && temperature <= WEATHER_THRESHOLDS.HOT_TEMP) return "Cold & Bright";
  
  return "Undecided";
}

async function checkWeatherMood() {
  try {
    await authorizeGoogleSheets();
    
    // Parse date argument (default: 2026-01-08)
    const dateArg = process.argv[2] || '2026-01-08';
    const timeArg = process.argv[3] || '09:30';
    
    const [year, month, day] = dateArg.split('-').map(Number);
    const [hour, minute] = timeArg.split(':').map(Number);
    
    // Create target date in KST
    const targetDate = new Date(year, month - 1, day, hour, minute);
    const targetKstDate = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    console.log(`\n📅 Checking weather mood for ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} KST\n`);
    
    // Read all replay feed data
    const allData = await readReplayFeed(10000, 'Replay Feed');
    
    if (allData.length === 0) {
      console.log('❌ No data found in Replay Feed');
      return;
    }
    
    // Filter to target date (KST)
    const targetYear = targetKstDate.getFullYear();
    const targetMonth = targetKstDate.getMonth();
    const targetDay = targetKstDate.getDate();
    
    const dateData = allData.filter(d => {
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return kstDate.getFullYear() === targetYear && 
             kstDate.getMonth() === targetMonth && 
             kstDate.getDate() === targetDay;
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    if (dateData.length === 0) {
      console.log(`❌ No data found for ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} in Replay Feed`);
      console.log(`   Available dates in Replay Feed:`);
      const uniqueDates = new Set();
      allData.forEach(d => {
        const date = new Date(d.tsMs);
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const dateStr = `${kstDate.getFullYear()}-${String(kstDate.getMonth() + 1).padStart(2, '0')}-${String(kstDate.getDate()).padStart(2, '0')}`;
        uniqueDates.add(dateStr);
      });
      Array.from(uniqueDates).sort().forEach(d => console.log(`   - ${d}`));
      return;
    }
    
    console.log(`✅ Found ${dateData.length} sensor readings for ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}\n`);
    
    // Find first reading with positive power (market opening condition)
    const firstPositivePower = dateData.find(d => parseFloat(d.power) > 0);
    
    if (!firstPositivePower) {
      console.log('⚠️ No readings with positive power found for this date');
      console.log('   Using first available reading instead...\n');
    }
    
    const sampleReading = firstPositivePower || dateData[0];
    
    // Determine mood from sensor data
    const sensorData = {
      lux: parseFloat(sampleReading.lux) || 0,
      temperature: parseFloat(sampleReading.temperature) || 0,
      humidity: parseFloat(sampleReading.humidity) || 0
    };
    
    const mood = determineTradeMood(sensorData);
    const moodName = moodNameMap[mood] || mood;
    const suggestedStocks = moodStockMap[mood] || [];
    
    console.log('🌤️  Weather Data:');
    console.log(`   Lux: ${sensorData.lux}`);
    console.log(`   Temperature: ${sensorData.temperature}°C`);
    console.log(`   Humidity: ${sensorData.humidity}%`);
    console.log(`   Power: ${parseFloat(sampleReading.power) || 0}`);
    console.log('');
    console.log('🎭 Weather Mood:');
    console.log(`   ${moodName}`);
    console.log(`   (${mood})`);
    console.log('');
    console.log('📈 Suggested Stocks:');
    if (suggestedStocks.length > 0) {
      suggestedStocks.forEach(stock => console.log(`   - ${stock}`));
    } else {
      console.log('   (No stocks suggested for this mood)');
    }
    console.log('');
    
    // Show all readings for the day with their moods
    console.log('📊 All readings for this date:');
    console.log('   Time (KST)     | Lux      | Temp  | Humidity | Power  | Mood');
    console.log('   ' + '-'.repeat(70));
    
    dateData.slice(0, 20).forEach(d => {
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const timeStr = `${String(kstDate.getHours()).padStart(2, '0')}:${String(kstDate.getMinutes()).padStart(2, '0')}`;
      const lux = parseFloat(d.lux) || 0;
      const temp = parseFloat(d.temperature) || 0;
      const hum = parseFloat(d.humidity) || 0;
      const power = parseFloat(d.power) || 0;
      const readingMood = determineTradeMood({ lux, temperature: temp, humidity: hum });
      
      console.log(`   ${timeStr.padEnd(15)} | ${String(lux).padStart(8)} | ${String(temp).padStart(5)} | ${String(hum).padStart(8)} | ${String(power).padStart(6)} | ${readingMood}`);
    });
    
    if (dateData.length > 20) {
      console.log(`   ... and ${dateData.length - 20} more readings`);
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkWeatherMood();

