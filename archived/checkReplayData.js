#!/usr/bin/env node
/**
 * Check Replay Feed data for today and verify trading readiness
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function checkReplayData() {
  try {
    console.log('🔐 Authorizing Google Sheets...\n');
    await authorizeGoogleSheets();
    
    // Get current EST date
    const now = new Date();
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const targetYear = est.getFullYear();
    const targetMonth = est.getMonth();
    const targetDay = est.getDate();
    
    console.log('📅 현재 시간:');
    console.log(`   KST: ${kst.toLocaleString('ko-KR')}`);
    console.log(`   EST: ${est.toLocaleString('en-US')}`);
    console.log(`   타겟 날짜: ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')} (EST 기준)\n`);
    
    // Read all replay data
    console.log('📖 Reading Replay Feed data...\n');
    const allData = await readReplayFeed(Infinity, 'Replay Feed');
    
    if (allData.length === 0) {
      console.log('❌ No data found in Replay Feed sheet');
      return;
    }
    
    console.log(`✅ Total entries in Replay Feed: ${allData.length}\n`);
    
    // Filter data for today (EST date)
    const todayData = allData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return (
        itemKst.getFullYear() === targetYear &&
        itemKst.getMonth() === targetMonth &&
        itemKst.getDate() === targetDay
      );
    });
    
    console.log(`📊 Today's data (${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')} EST 기준): ${todayData.length} entries\n`);
    
    if (todayData.length === 0) {
      console.log('⚠️ No data found for today in Replay Feed');
      console.log('   오늘 날짜 데이터를 Replay Feed에 추가해야 합니다.\n');
      
      // Show latest data dates
      const latest = allData[allData.length - 1];
      const latestDate = new Date(latest.tsMs);
      const latestKst = new Date(latestDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      console.log(`📅 Latest data date: ${latestKst.toLocaleString('ko-KR')}`);
      return;
    }
    
    // Show time range
    const first = todayData[0];
    const last = todayData[todayData.length - 1];
    const firstKst = new Date(first.tsMs);
    const lastKst = new Date(last.tsMs);
    const firstKstStr = new Date(firstKst.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const lastKstStr = new Date(lastKst.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    console.log(`⏰ Time range:`);
    console.log(`   Start: ${firstKstStr.toLocaleTimeString('ko-KR')} KST`);
    console.log(`   End: ${lastKstStr.toLocaleTimeString('ko-KR')} KST\n`);
    
    // Check power values
    const powerPositive = todayData.filter(d => d.power > 0);
    console.log(`⚡ Power status:`);
    console.log(`   Positive power entries: ${powerPositive.length}/${todayData.length}`);
    console.log(`   (Need 5+ consecutive positive power to start trading)\n`);
    
    // Show sample entries
    console.log('📋 Sample entries (first 5):');
    todayData.slice(0, 5).forEach((item, idx) => {
      const itemKst = new Date(item.tsMs);
      const kstStr = new Date(itemKst.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      console.log(`   ${idx + 1}. ${kstStr.toLocaleTimeString('ko-KR')} - Lux: ${item.lux}, Temp: ${item.temperature}°C, Power: ${item.power}`);
    });
    
    // Check market hours
    const marketOpenHour = 9;
    const marketOpenMinute = 30;
    const marketCloseHour = 16;
    const marketCloseMinute = 0;
    
    console.log('\n🏛️  Market hours (EST):');
    console.log(`   Open: ${marketOpenHour}:${String(marketOpenMinute).padStart(2, '0')} EST`);
    console.log(`   Close: ${marketCloseHour}:${String(marketCloseMinute).padStart(2, '0')} EST`);
    console.log(`   (KST: ${marketOpenHour + 14}:${String(marketOpenMinute).padStart(2, '0')} - ${marketCloseHour + 14}:${String(marketCloseMinute).padStart(2, '0')})\n`);
    
    // Check if current time is within market hours
    const currentEstHour = est.getHours();
    const currentEstMinute = est.getMinutes();
    const isMarketOpen = (
      currentEstHour > marketOpenHour || 
      (currentEstHour === marketOpenHour && currentEstMinute >= marketOpenMinute)
    ) && (
      currentEstHour < marketCloseHour || 
      (currentEstHour === marketCloseHour && currentEstMinute < marketCloseMinute)
    );
    
    console.log(`📊 Current market status:`);
    console.log(`   EST: ${currentEstHour}:${String(currentEstMinute).padStart(2, '0')}`);
    console.log(`   Market: ${isMarketOpen ? '✅ OPEN' : '❌ CLOSED'}\n`);
    
    // Check environment variables
    console.log('🔧 Environment check:');
    console.log(`   REPLAY_MODE: ${process.env.REPLAY_MODE || 'not set'}`);
    console.log(`   REPLAY_TRADE: ${process.env.REPLAY_TRADE || 'not set'}`);
    console.log(`   GOOGLE_SPREADSHEET_ID: ${process.env.GOOGLE_SPREADSHEET_ID ? '✅ set' : '❌ not set'}`);
    console.log(`   GOOGLE_CREDENTIALS: ${process.env.GOOGLE_CREDENTIALS ? '✅ set' : '❌ not set'}`);
    console.log(`   ALPACA_API_KEY: ${process.env.ALPACA_API_KEY ? '✅ set' : '❌ not set'}`);
    console.log(`   ALPACA_SECRET_KEY: ${process.env.ALPACA_SECRET_KEY ? '✅ set' : '❌ not set'}\n`);
    
    if (todayData.length > 0 && powerPositive.length >= 5) {
      console.log('✅ Ready for trading!');
      console.log('   - Today\'s data exists');
      console.log('   - Power positive entries sufficient');
      if (isMarketOpen) {
        console.log('   - Market is currently open');
      } else {
        console.log('   - Market will open at 9:30 AM EST');
      }
    } else {
      console.log('⚠️ Not ready for trading:');
      if (todayData.length === 0) {
        console.log('   - No data for today');
      }
      if (powerPositive.length < 5) {
        console.log(`   - Need more positive power entries (currently ${powerPositive.length}, need 5+)`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  checkReplayData();
}

module.exports = { checkReplayData };

