#!/usr/bin/env node
/**
 * Check why trading is not happening
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function checkTradingStatus() {
  console.log('🔍 트레이딩 상태 확인 중...\n');

  // 1. 환경 변수 확인
  console.log('1️⃣ 환경 변수 확인:');
  const REPLAY_MODE = process.env.MODE === 'replay' || process.env.REPLAY_MODE === 'true';
  const REPLAY_TRADE = process.env.REPLAY_TRADE === 'true';
  const SHEETS_ENABLED = !!process.env.GOOGLE_CREDENTIALS;
  
  console.log(`   REPLAY_MODE: ${REPLAY_MODE ? '✅ true' : '❌ false'}`);
  console.log(`   REPLAY_TRADE: ${REPLAY_TRADE ? '✅ true' : '❌ false'}`);
  console.log(`   GOOGLE_CREDENTIALS: ${SHEETS_ENABLED ? '✅ 설정됨' : '❌ 없음'}`);
  
  if (!REPLAY_MODE) {
    console.log('\n❌ 문제: REPLAY_MODE가 false입니다!');
    console.log('   해결: Render.com에서 REPLAY_MODE=true 설정');
    return;
  }
  
  if (!REPLAY_TRADE) {
    console.log('\n❌ 문제: REPLAY_TRADE가 false입니다!');
    console.log('   해결: Render.com에서 REPLAY_TRADE=true 설정');
    return;
  }

  // 2. 시장 시간 확인
  console.log('\n2️⃣ 시장 시간 확인:');
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  const hour = est.getHours();
  const minute = est.getMinutes();
  const isWeekday = day !== 0 && day !== 6;
  const marketOpen = hour > 9 || (hour === 9 && minute >= 30);
  const marketClosed = hour >= 16;
  const isMarketOpen = isWeekday && marketOpen && !marketClosed;
  
  console.log(`   현재 EST: ${est.toLocaleString('en-US')}`);
  console.log(`   요일: ${['일', '월', '화', '수', '목', '금', '토'][day]}요일`);
  console.log(`   시장 상태: ${isMarketOpen ? '✅ 열림' : '❌ 닫힘'}`);
  
  if (!isMarketOpen) {
    console.log('\n⚠️ 시장이 닫혀있습니다.');
    if (!isWeekday) {
      console.log('   원인: 주말입니다.');
    } else if (hour < 9 || (hour === 9 && minute < 30)) {
      console.log('   원인: 시장이 아직 열리지 않았습니다 (9:30 AM EST 이후)');
    } else {
      console.log('   원인: 시장이 이미 닫혔습니다 (4:00 PM EST 이후)');
    }
    console.log(`   다음 개장: ${isWeekday && hour < 9 ? '오늘 9:30 AM EST' : '다음 평일 9:30 AM EST'}`);
  }

  // 3. 데이터 확인
  console.log('\n3️⃣ Replay 데이터 확인:');
  try {
    await authorizeGoogleSheets();
    const data = await readReplayFeed(2000, 'Replay Feed');
    
    // Filter for today (EST)
    const estToday = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const targetYear = estToday.getFullYear();
    const targetMonth = estToday.getMonth();
    const targetDay = estToday.getDate();
    
    const todayData = data.filter(d => {
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return kstDate.getFullYear() === targetYear && 
             kstDate.getMonth() === targetMonth && 
             kstDate.getDate() === targetDay;
    });
    
    console.log(`   총 데이터: ${data.length}개`);
    console.log(`   오늘 데이터 (${targetYear}-${targetMonth+1}-${targetDay}): ${todayData.length}개`);
    
    if (todayData.length === 0) {
      console.log('\n❌ 문제: 오늘 날짜의 데이터가 없습니다!');
      console.log('   해결: "Replay Feed" 시트에 오늘 날짜 데이터 추가');
      return;
    }
    
    // Check power values
    let powerPositiveCount = 0;
    let powerZeroCount = 0;
    const powerSequence = [];
    
    for (const d of todayData.slice(0, 20)) {
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
    console.log(`   Power > 0 연속: ${powerPositiveCount}개 (필요: 5개)`);
    
    if (powerPositiveCount < 5) {
      console.log('\n❌ 문제: Power > 0가 5번 연속되지 않았습니다!');
      console.log('   해결: "Replay Feed" 시트에서 Power 값이 양수인 데이터 확인');
    }
    
  } catch (error) {
    console.error('\n❌ 데이터 확인 실패:', error.message);
  }

  // 4. Render.com 로그 확인 안내
  console.log('\n4️⃣ Render.com 로그 확인:');
  console.log('   Render.com 대시보드 → Logs 탭에서 다음 메시지 확인:');
  console.log('   ✅ "🎬 Starting replay mode..."');
  console.log('   ✅ "📊 Loaded X sensor readings..."');
  console.log('   ✅ "🔄 Processing KST..." (시장 시간에만 나타남)');
  console.log('   ✅ "Market Open" 또는 "powerPositiveCount >= 5"');
  
  console.log('\n📋 요약:');
  if (!REPLAY_MODE || !REPLAY_TRADE) {
    console.log('   ❌ 환경 변수 설정 필요');
  } else if (!isMarketOpen) {
    console.log('   ⏰ 시장이 닫혀있음 (정상)');
  } else {
    console.log('   ✅ 모든 조건 충족 - Render.com 로그 확인 필요');
  }
}

checkTradingStatus().catch(console.error);
