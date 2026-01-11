#!/usr/bin/env node
/**
 * Monitor trading conditions and alert when ready
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function monitorTrading() {
  console.log('🔍 트레이딩 조건 모니터링 시작...\n');
  console.log('(Ctrl+C로 종료)\n');

  let lastPowerCount = 0;
  let checkCount = 0;

  const checkInterval = setInterval(async () => {
    checkCount++;
    try {
      // Current time
      const now = new Date();
      const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = est.getHours();
      const minute = est.getMinutes();
      const day = est.getDay();
      const isWeekday = day !== 0 && day !== 6;
      const isMarketHours = isWeekday && hour >= 9 && hour < 16 && (hour > 9 || minute >= 30);

      // Read data
      await authorizeGoogleSheets();
      const allData = await readReplayFeed(2000, 'Replay Feed');
      
      const targetYear = est.getFullYear();
      const targetMonth = est.getMonth();
      const targetDay = est.getDate();
      
      const todayData = allData.filter(d => {
        const date = new Date(d.tsMs);
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        return kstDate.getFullYear() === targetYear && 
               kstDate.getMonth() === targetMonth && 
               kstDate.getDate() === targetDay;
      });

      // Check power values
      let powerPositiveCount = 0;
      const powerSequence = [];
      
      for (let i = 0; i < Math.min(20, todayData.length); i++) {
        const d = todayData[i];
        if (d.power > 0) {
          powerPositiveCount++;
          powerSequence.push('+');
        } else {
          powerPositiveCount = 0;
          powerSequence.push('0');
        }
      }

      // Status update
      const timestamp = new Date().toLocaleTimeString('ko-KR');
      const status = [];
      
      status.push(`[${timestamp}] 체크 #${checkCount}`);
      status.push(`시장: ${isMarketHours ? '✅ 열림' : '❌ 닫힘'}`);
      status.push(`Power > 0 연속: ${powerPositiveCount}/5`);
      
      if (powerPositiveCount !== lastPowerCount) {
        status.push(`🔄 변경됨! (이전: ${lastPowerCount})`);
        lastPowerCount = powerPositiveCount;
      }

      // Alert if ready
      if (powerPositiveCount >= 5 && isMarketHours) {
        console.log('\n' + '='.repeat(60));
        console.log('🚀 트레이딩 시작 가능!');
        console.log('='.repeat(60));
        console.log(`   Power > 0 연속: ${powerPositiveCount}개 ✅`);
        console.log(`   시장 상태: 열림 ✅`);
        console.log(`   데이터: ${todayData.length}개 ✅`);
        console.log('='.repeat(60) + '\n');
      } else {
        console.log(status.join(' | '));
        
        if (powerPositiveCount < 5 && isMarketHours) {
          const needed = 5 - powerPositiveCount;
          console.log(`   ⏳ Power > 0가 ${needed}개 더 필요합니다`);
        }
      }

    } catch (error) {
      console.error(`❌ 오류 (체크 #${checkCount}):`, error.message);
    }
  }, 30000); // Check every 30 seconds

  // Handle exit
  process.on('SIGINT', () => {
    console.log('\n\n👋 모니터링 종료');
    clearInterval(checkInterval);
    process.exit(0);
  });
}

monitorTrading().catch(console.error);

