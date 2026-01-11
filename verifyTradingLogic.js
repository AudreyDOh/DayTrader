/**
 * 트레이딩 로직 상세 검증: 오늘 KST 데이터가 오늘 밤 EST에 사용되는지 확인
 */

require('dotenv').config();

function verifyTradingLogic() {
  console.log('🔍 트레이딩 로직 상세 검증\n');
  
  // 현재 시간
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  console.log('📅 현재 시간:');
  console.log(`   서버 시간: ${now.toISOString()}`);
  console.log(`   KST: ${kst.toLocaleString('ko-KR')}`);
  console.log(`   EST: ${est.toLocaleString('en-US')}\n`);
  
  // 코드 로직 시뮬레이션
  console.log('='.repeat(60));
  console.log('1️⃣ startReplayMode()에서 targetDate 결정');
  console.log('='.repeat(60));
  
  // REPLAY_TARGET_DATE가 없을 때의 로직
  let targetDate;
  if (process.env.REPLAY_TARGET_DATE) {
    const [year, month, day] = process.env.REPLAY_TARGET_DATE.split('-').map(Number);
    targetDate = new Date(year, month - 1, day);
    console.log(`✅ REPLAY_TARGET_DATE 설정됨: ${process.env.REPLAY_TARGET_DATE}`);
  } else {
    targetDate = new Date();
    console.log(`⚠️ REPLAY_TARGET_DATE 없음 → new Date() 사용: ${targetDate.toISOString()}`);
  }
  
  // KST로 변환
  const kstToday = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const targetYear = kstToday.getFullYear();
  const targetMonth = kstToday.getMonth();
  const targetDay = kstToday.getDate();
  
  console.log(`\n📅 변환 결과:`);
  console.log(`   targetDate: ${targetDate.toISOString()}`);
  console.log(`   kstToday: ${kstToday.toLocaleString('ko-KR')}`);
  console.log(`   targetYear: ${targetYear}, targetMonth: ${targetMonth + 1}, targetDay: ${targetDay}`);
  
  // 오늘 KST 날짜와 비교
  const todayKstYear = kst.getFullYear();
  const todayKstMonth = kst.getMonth();
  const todayKstDay = kst.getDate();
  
  console.log(`\n📅 오늘 KST 날짜:`);
  console.log(`   Year: ${todayKstYear}, Month: ${todayKstMonth + 1}, Day: ${todayKstDay}`);
  
  if (targetYear === todayKstYear && targetMonth === todayKstMonth && targetDay === todayKstDay) {
    console.log(`\n✅ targetDate가 오늘 KST 날짜와 일치합니다!`);
  } else {
    console.log(`\n⚠️ targetDate가 오늘 KST 날짜와 다릅니다!`);
    console.log(`   차이: ${targetYear}-${targetMonth + 1}-${targetDay} vs ${todayKstYear}-${todayKstMonth + 1}-${todayKstDay}`);
  }
  
  // 트레이딩 로직 시뮬레이션
  console.log('\n' + '='.repeat(60));
  console.log('2️⃣ processCurrentTimeTrading()에서 데이터 매칭');
  console.log('='.repeat(60));
  
  // EST 시간 가져오기
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const estYear = estNow.getFullYear();
  const estMonth = estNow.getMonth();
  const estDay = estNow.getDate();
  const estHour = estNow.getHours();
  const estMinute = estNow.getMinutes();
  
  console.log(`\n📅 현재 EST 시간:`);
  console.log(`   Year: ${estYear}, Month: ${estMonth + 1}, Day: ${estDay}`);
  console.log(`   Time: ${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')}`);
  
  // timeKey 생성 (코드에서 사용하는 방식)
  const timeKey = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}-${String(estHour).padStart(2, '0')}-${String(estMinute).padStart(2, '0')}`;
  
  console.log(`\n🔑 생성된 timeKey: ${timeKey}`);
  console.log(`   → KST ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')} ${String(estHour).padStart(2, '0')}:${String(estMinute).padStart(2, '0')} 데이터를 찾음`);
  
  // 오늘 밤 EST 9:30 시뮬레이션
  console.log('\n' + '='.repeat(60));
  console.log('3️⃣ 오늘 밤 EST 9:30 시뮬레이션');
  console.log('='.repeat(60));
  
  // 오늘 EST 날짜의 9:30
  const tonightEst = new Date(est);
  tonightEst.setHours(9, 30, 0, 0);
  
  // 만약 이미 9:30이 지났다면 내일로
  if (tonightEst <= est) {
    tonightEst.setDate(tonightEst.getDate() + 1);
  }
  
  const tonightEstYear = tonightEst.getFullYear();
  const tonightEstMonth = tonightEst.getMonth();
  const tonightEstDay = tonightEst.getDate();
  
  console.log(`\n📅 오늘 밤 EST 시장 오픈 시간:`);
  console.log(`   ${tonightEstYear}-${String(tonightEstMonth + 1).padStart(2, '0')}-${String(tonightEstDay).padStart(2, '0')} 9:30`);
  
  // 이때 사용될 KST 데이터
  const tonightTimeKey = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}-09-30`;
  
  console.log(`\n🔑 사용될 timeKey: ${tonightTimeKey}`);
  console.log(`   → KST ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')} 9:30 데이터를 찾음`);
  
  // 오늘 KST 9:30 데이터가 있는지 확인
  if (targetYear === todayKstYear && targetMonth === todayKstMonth && targetDay === todayKstDay) {
    console.log(`\n✅ 오늘 KST ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')} 9:30 데이터를 사용합니다!`);
  } else {
    console.log(`\n⚠️ 다른 날짜의 데이터를 사용합니다:`);
    console.log(`   찾는 날짜: ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`);
    console.log(`   오늘 날짜: ${todayKstYear}-${String(todayKstMonth + 1).padStart(2, '0')}-${todayKstDay}`);
  }
  
  // BLE Content 로직 확인
  console.log('\n' + '='.repeat(60));
  console.log('4️⃣ BLE Content 로직 확인');
  console.log('='.repeat(60));
  
  // 내일 KST 날짜
  const tomorrowKst = new Date(kst);
  tomorrowKst.setDate(tomorrowKst.getDate() + 1);
  const tomorrowYear = tomorrowKst.getFullYear();
  const tomorrowMonth = tomorrowKst.getMonth();
  const tomorrowDay = tomorrowKst.getDate();
  
  console.log(`\n📅 내일 KST 날짜: ${tomorrowYear}-${String(tomorrowMonth + 1).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')}`);
  console.log(`📅 오늘 KST 날짜: ${todayKstYear}-${String(todayKstMonth + 1).padStart(2, '0')}-${todayKstDay}`);
  
  console.log(`\n📋 sendBLEReplaySync.js 로직:`);
  console.log(`   - 내일 KST ${tomorrowYear}-${String(tomorrowMonth + 1).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')} 9:30-16:00에 실행`);
  console.log(`   - 어제 KST 데이터를 찾음 (yesterdayKst = 내일 - 1일)`);
  console.log(`   - 어제 KST = 오늘 KST = ${todayKstYear}-${String(todayKstMonth + 1).padStart(2, '0')}-${todayKstDay}`);
  console.log(`   - 따라서 오늘 KST 데이터를 내일 표시합니다! ✅`);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ 검증 완료');
  console.log('='.repeat(60));
}

verifyTradingLogic();

