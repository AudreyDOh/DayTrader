#!/usr/bin/env node
/**
 * Detailed trading diagnosis
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function debugTradingDetailed() {
  console.log('🔍 상세 트레이딩 진단 시작...\n');

  // 1. 현재 시간 확인
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  
  console.log('1️⃣ 현재 시간:');
  console.log(`   KST: ${kst.toLocaleString('ko-KR')}`);
  console.log(`   EST: ${est.toLocaleString('en-US')}`);
  console.log(`   EST 요일: ${['일', '월', '화', '수', '목', '금', '토'][est.getDay()]}요일`);
  
  const hour = est.getHours();
  const minute = est.getMinutes();
  const isWeekday = est.getDay() !== 0 && est.getDay() !== 6;
  const isMarketHours = isWeekday && hour >= 9 && hour < 16 && (hour > 9 || minute >= 30);
  
  console.log(`   시장 상태: ${isMarketHours ? '✅ 열림' : '❌ 닫힘'}`);
  if (!isMarketHours) {
    if (!isWeekday) {
      console.log(`   ⚠️ 주말입니다 (시장 닫힘)`);
    } else if (hour < 9 || (hour === 9 && minute < 30)) {
      console.log(`   ⚠️ 시장이 아직 열리지 않았습니다 (9:30 AM EST 이후)`);
      const minsUntilOpen = (9 * 60 + 30) - (hour * 60 + minute);
      console.log(`   다음 개장까지: ${Math.floor(minsUntilOpen / 60)}시간 ${minsUntilOpen % 60}분`);
    } else {
      console.log(`   ⚠️ 시장이 이미 닫혔습니다 (4:00 PM EST 이후)`);
    }
  }

  // 2. 데이터 확인
  console.log('\n2️⃣ Replay 데이터 확인:');
  try {
    await authorizeGoogleSheets();
    const allData = await readReplayFeed(2000, 'Replay Feed');
    console.log(`   총 데이터: ${allData.length}개`);
    
    // Filter for today (EST date)
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
    
    console.log(`   오늘 데이터 (${targetYear}-${targetMonth+1}-${targetDay} EST 기준): ${todayData.length}개`);
    
    if (todayData.length === 0) {
      console.log('\n   ⚠️ 오늘 날짜의 데이터가 없습니다!');
      console.log('   → "Replay Feed" 시트에 오늘 날짜 데이터 추가 필요');
      
      // Show what dates we have
      const dates = new Set();
      allData.slice(0, 50).forEach(d => {
        const date = new Date(d.tsMs);
        const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        dates.add(`${kstDate.getFullYear()}-${kstDate.getMonth()+1}-${kstDate.getDate()}`);
      });
      console.log(`   사용 가능한 날짜 (샘플): ${Array.from(dates).slice(0, 5).join(', ')}`);
      return;
    }
    
    // Check power values
    console.log('\n3️⃣ Power 값 분석:');
    let powerPositiveCount = 0;
    let powerZeroCount = 0;
    const powerSequence = [];
    const powerDetails = [];
    
    for (let i = 0; i < Math.min(20, todayData.length); i++) {
      const d = todayData[i];
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      
      if (d.power > 0) {
        powerPositiveCount++;
        powerZeroCount = 0;
        powerSequence.push('+');
      } else {
        powerZeroCount++;
        powerPositiveCount = 0;
        powerSequence.push('0');
      }
      
      powerDetails.push({
        time: kstDate.toLocaleTimeString('ko-KR'),
        power: d.power,
        isPositive: d.power > 0
      });
    }
    
    console.log(`   Power 시퀀스 (처음 ${Math.min(20, todayData.length)}개): ${powerSequence.join('')}`);
    console.log(`   Power > 0 연속: ${powerPositiveCount}개 (필요: 5개)`);
    
    if (powerPositiveCount < 5) {
      console.log('\n   ❌ 문제: Power > 0가 5번 연속되지 않았습니다!');
      console.log('   → "Replay Feed" 시트에서 Power 값을 양수로 수정 필요');
      console.log('\n   Power 상세 (처음 10개):');
      powerDetails.slice(0, 10).forEach((p, i) => {
        console.log(`     ${i+1}. ${p.time}: ${p.power} ${p.isPositive ? '✅' : '❌'}`);
      });
    } else {
      console.log('   ✅ Power 조건 충족');
    }
    
    // 4. 시간 매칭 확인
    console.log('\n4️⃣ 시간 매칭 확인:');
    const currentEstHour = est.getHours();
    const currentEstMinute = est.getMinutes();
    
    // Find data that should match current EST time
    const matchingData = todayData.filter(d => {
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const kstHour = kstDate.getHours();
      const kstMinute = kstDate.getMinutes();
      
      // KST time should match EST time (same hour:minute)
      return kstHour === currentEstHour && Math.abs(kstMinute - currentEstMinute) <= 1;
    });
    
    console.log(`   현재 EST 시간: ${currentEstHour}:${String(currentEstMinute).padStart(2, '0')}`);
    console.log(`   매칭되는 데이터: ${matchingData.length}개`);
    
    if (matchingData.length === 0 && isMarketHours) {
      console.log('\n   ⚠️ 현재 EST 시간과 매칭되는 데이터가 없습니다!');
      console.log('   → 데이터의 KST 시간이 현재 EST 시간과 일치해야 합니다');
      console.log('\n   오늘 데이터 시간 범위:');
      if (todayData.length > 0) {
        const first = new Date(todayData[0].tsMs);
        const last = new Date(todayData[todayData.length - 1].tsMs);
        const firstKst = new Date(first.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const lastKst = new Date(last.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        console.log(`     ${firstKst.toLocaleTimeString('ko-KR')} - ${lastKst.toLocaleTimeString('ko-KR')} (KST)`);
      }
    } else if (matchingData.length > 0) {
      console.log('   ✅ 시간 매칭 데이터 있음');
    }
    
  } catch (error) {
    console.error('\n❌ 데이터 확인 실패:', error.message);
    console.error(error.stack);
  }

  // 5. Render.com 확인 안내
  console.log('\n5️⃣ Render.com 확인:');
  console.log('   Render.com 대시보드 → Logs 탭에서 확인:');
  console.log('   ✅ "🔄 Processing KST ... → EST ..." 메시지');
  console.log('   ✅ "Current powerPositiveCount: X" 값');
  console.log('   ✅ "Market Open" 또는 "marketOpen: true"');
  console.log('   ❌ 에러 메시지 확인');
  
  console.log('\n📋 요약:');
  if (!isMarketHours) {
    console.log('   ⏰ 시장이 닫혀있음 (정상)');
  } else if (todayData.length === 0) {
    console.log('   ❌ 오늘 날짜 데이터 없음');
  } else if (powerPositiveCount < 5) {
    console.log('   ❌ Power > 0 연속 5개 미만');
  } else {
    console.log('   ✅ 기본 조건 충족 - Render.com 로그 확인 필요');
  }
}

debugTradingDetailed().catch(console.error);

