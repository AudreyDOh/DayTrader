/* 
거래가 실행되지 않는 이유 디버깅
*/

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function debugTrading() {
  console.log('🔍 거래 실행 문제 진단\n');
  
  // 1. 환경 변수
  const REPLAY_MODE = process.env.MODE === 'replay' || process.env.REPLAY_MODE === 'true';
  const REPLAY_TRADE = process.env.REPLAY_TRADE === 'true';
  console.log('1️⃣ 환경 변수:');
  console.log(`   REPLAY_MODE: ${REPLAY_MODE}`);
  console.log(`   REPLAY_TRADE: ${REPLAY_TRADE}\n`);
  
  // 2. 시장 시간
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  const hour = est.getHours();
  const minute = est.getMinutes();
  const isWeekday = day !== 0 && day !== 6;
  const marketOpen = hour > 9 || (hour === 9 && minute >= 30);
  const marketClosed = hour >= 16;
  const isMarketOpen = isWeekday && marketOpen && !marketClosed;
  
  console.log('2️⃣ 시장 시간:');
  console.log(`   현재 EST: ${est.toLocaleString('en-US')}`);
  console.log(`   시장 상태: ${isMarketOpen ? '✅ 열림' : '❌ 닫힘'}\n`);
  
  // 3. 데이터 확인
  await authorizeGoogleSheets();
  const data = await readReplayFeed(500, 'Replay Feed');
  const jan2Data = data.filter(d => {
    const date = new Date(d.tsMs);
    return date.getFullYear() === 2026 && date.getMonth() === 0 && date.getDate() === 2 && date.getHours() >= 13;
  });
  
  console.log('3️⃣ 1/2 오후 1시 이후 데이터:');
  console.log(`   총 데이터: ${jan2Data.length}개`);
  
  // Power 값 확인
  let powerPositiveCount = 0;
  let powerZeroCount = 0;
  const powerSequence = [];
  
  for (const d of jan2Data.slice(0, 20)) {
    if (d.power > 0) {
      powerPositiveCount++;
      powerZeroCount = 0;
      powerSequence.push('+');
    } else {
      powerZeroCount++;
      powerPositiveCount = 0;
      powerSequence.push('0');
    }
  }
  
  console.log(`   Power 시퀀스 (처음 20개): ${powerSequence.join('')}`);
  console.log(`   Power > 0 연속: ${powerPositiveCount}개 (5개 이상 필요)\n`);
  
  // 4. 시간 매칭 확인
  console.log('4️⃣ 시간 매칭 확인:');
  if (jan2Data.length > 0) {
    const sample = jan2Data[0];
    const kst = new Date(sample.tsMs);
    const kstYear = kst.getFullYear();
    const kstMonth = kst.getMonth();
    const kstDay = kst.getDate();
    const kstHour = kst.getHours();
    const kstMinute = kst.getMinutes();
    
    const estYear = est.getFullYear();
    const estMonth = est.getMonth();
    const estDay = est.getDate();
    const estHour = est.getHours();
    const estMinute = est.getMinutes();
    
    console.log(`   한국 데이터: ${kstYear}-${kstMonth+1}-${kstDay} ${kstHour}:${kstMinute}`);
    console.log(`   현재 미국: ${estYear}-${estMonth+1}-${estDay} ${estHour}:${estMinute}`);
    
    const timeMatches = 
      kstYear === estYear &&
      kstMonth === estMonth &&
      kstDay === estDay &&
      kstHour === estHour &&
      Math.abs(kstMinute - estMinute) <= 1;
    
    const timeHasPassed = 
      kstYear === estYear &&
      kstMonth === estMonth &&
      kstDay === estDay &&
      (kstHour < estHour || (kstHour === estHour && kstMinute < estMinute));
    
    console.log(`   시간 매칭: ${timeMatches ? '✅' : '❌'}`);
    console.log(`   시간 지남: ${timeHasPassed ? '✅' : '❌'}\n`);
  }
  
  // 5. 거래 조건 요약
  console.log('5️⃣ 거래 실행 조건:');
  console.log(`   1. REPLAY_MODE=true: ${REPLAY_MODE ? '✅' : '❌'}`);
  console.log(`   2. REPLAY_TRADE=true: ${REPLAY_TRADE ? '✅' : '❌'}`);
  console.log(`   3. 시장 열림: ${isMarketOpen ? '✅' : '❌'}`);
  console.log(`   4. Power 5번 연속 양수: ${powerPositiveCount >= 5 ? '✅' : '❌'} (현재: ${powerPositiveCount})`);
  console.log(`   5. 시간 매칭 또는 지남: ${timeMatches || timeHasPassed ? '✅' : '❌'}\n`);
  
  // 6. 문제 진단
  console.log('6️⃣ 문제 진단:');
  if (!REPLAY_MODE) {
    console.log('   ❌ REPLAY_MODE가 false입니다!');
  }
  if (!REPLAY_TRADE) {
    console.log('   ❌ REPLAY_TRADE가 false입니다!');
  }
  if (!isMarketOpen) {
    console.log('   ❌ 시장이 닫혀있습니다!');
  }
  if (powerPositiveCount < 5) {
    console.log('   ❌ Power가 5번 연속 양수가 아닙니다!');
    console.log(`      (현재: ${powerPositiveCount}개, 필요: 5개)`);
  }
  if (!timeMatches && !timeHasPassed) {
    console.log('   ❌ 시간이 매칭되지 않았고 지나지도 않았습니다!');
    console.log('      (한국 시간을 미국 시간으로 변환했을 때 현재 시간과 일치해야 함)');
  }
}

debugTrading().catch(console.error);

