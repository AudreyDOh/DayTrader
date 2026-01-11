/**
 * 오늘(1/9) KST 9:30-4:00 데이터 확인 및 트레이딩/BLE 로직 검증
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed, readTradesFromSheet } = require('./logToSheets');

async function checkTodayDataAndTrading() {
  try {
    console.log('🔐 Authorizing Google Sheets...\n');
    await authorizeGoogleSheets();
    
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    console.log('📅 현재 시간:');
    console.log(`   KST: ${kst.toLocaleString('ko-KR')}`);
    console.log(`   EST: ${est.toLocaleString('en-US')}\n`);
    
    // 오늘 KST 날짜 (1/9)
    const todayKst = new Date(kst);
    const todayYear = todayKst.getFullYear();
    const todayMonth = todayKst.getMonth();
    const todayDay = todayKst.getDate();
    
    console.log(`📊 확인 대상: ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')} (KST)\n`);
    
    // 1. Replay Feed에서 오늘 KST 9:30-4:00 데이터 확인
    console.log('='.repeat(60));
    console.log('1️⃣ Replay Feed 데이터 확인 (오늘 KST 9:30-4:00)');
    console.log('='.repeat(60));
    
    const allSensorData = await readReplayFeed(10000, 'Replay Feed');
    
    const todayData = allSensorData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return (
        itemKst.getFullYear() === todayYear &&
        itemKst.getMonth() === todayMonth &&
        itemKst.getDate() === todayDay
      );
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    console.log(`✅ 오늘(KST) 전체 데이터: ${todayData.length}개`);
    
    // 시장 시간 데이터 필터링 (9:30-16:00)
    const marketHoursData = todayData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const hour = itemKst.getHours();
      const minute = itemKst.getMinutes();
      const totalMinutes = hour * 60 + minute;
      const startMinutes = 9 * 60 + 30; // 9:30
      const endMinutes = 16 * 60; // 16:00
      return totalMinutes >= startMinutes && totalMinutes < endMinutes;
    });
    
    console.log(`✅ 시장 시간(9:30-16:00) 데이터: ${marketHoursData.length}개\n`);
    
    if (marketHoursData.length === 0) {
      console.log('❌ 시장 시간 데이터가 없습니다!');
    } else {
      const firstData = marketHoursData[0];
      const lastData = marketHoursData[marketHoursData.length - 1];
      const firstKst = new Date(firstData.tsMs);
      const lastKst = new Date(lastData.tsMs);
      const firstKstFormatted = new Date(firstKst.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const lastKstFormatted = new Date(lastKst.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      
      console.log(`   첫 데이터: ${firstKstFormatted.getHours()}:${String(firstKstFormatted.getMinutes()).padStart(2, '0')} KST`);
      console.log(`   마지막 데이터: ${lastKstFormatted.getHours()}:${String(lastKstFormatted.getMinutes()).padStart(2, '0')} KST`);
      
      // Power > 0 데이터 확인
      const powerPositiveData = marketHoursData.filter(d => d.power > 0);
      console.log(`   Power > 0 데이터: ${powerPositiveData.length}개 (트레이딩에 필요: 5개 이상)`);
      
      if (powerPositiveData.length >= 5) {
        console.log(`   ✅ 트레이딩 가능: Power > 0 데이터 충분`);
      } else {
        console.log(`   ⚠️ 트레이딩 불가: Power > 0 데이터 부족`);
      }
    }
    
    // 2. 트레이딩 로직 확인
    console.log('\n' + '='.repeat(60));
    console.log('2️⃣ 트레이딩 로직 확인 (오늘 밤 EST 9:30-4:00)');
    console.log('='.repeat(60));
    
    console.log('\n📋 트레이딩 로직:');
    console.log('   - 오늘 KST 데이터를 사용하여 오늘 밤 EST 시장 시간에 트레이딩');
    console.log('   - EST 9:30 → KST 9:30 데이터 사용');
    console.log('   - EST 10:00 → KST 10:00 데이터 사용');
    console.log('   - ... (같은 날짜, 같은 시간)');
    
    // 오늘 EST 날짜 확인
    const todayEst = new Date(est);
    const estYear = todayEst.getFullYear();
    const estMonth = todayEst.getMonth();
    const estDay = todayEst.getDate();
    
    console.log(`\n📅 오늘 EST 날짜: ${estYear}-${String(estMonth + 1).padStart(2, '0')}-${String(estDay).padStart(2, '0')}`);
    console.log(`📅 오늘 KST 날짜: ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`);
    
    // 트레이딩이 진행될 시간대 확인
    console.log('\n⏰ 예상 트레이딩 시간:');
    console.log(`   EST ${estYear}-${String(estMonth + 1).padStart(2, '0')}-${String(estDay).padStart(2, '0')} 9:30-16:00`);
    console.log(`   → KST ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')} 9:30-16:00 데이터 사용`);
    
    // 데이터 매칭 확인
    if (marketHoursData.length > 0) {
      console.log('\n✅ 데이터 매칭 확인:');
      console.log(`   - KST ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')} 9:30-16:00 데이터: ${marketHoursData.length}개`);
      console.log(`   - EST ${estYear}-${String(estMonth + 1).padStart(2, '0')}-${String(estDay).padStart(2, '0')} 9:30-16:00에 사용 가능`);
      
      // 샘플 데이터 확인
      const sampleData = marketHoursData[Math.floor(marketHoursData.length / 2)];
      const sampleKst = new Date(sampleData.tsMs);
      const sampleKstFormatted = new Date(sampleKst.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const sampleHour = sampleKstFormatted.getHours();
      const sampleMinute = sampleKstFormatted.getMinutes();
      
      console.log(`\n   예시: EST ${sampleHour}:${String(sampleMinute).padStart(2, '0')} → KST ${sampleHour}:${String(sampleMinute).padStart(2, '0')} 데이터 사용`);
      console.log(`      Lux=${sampleData.lux}, Temp=${sampleData.temperature}, Power=${sampleData.power}`);
    }
    
    // 3. BLE Content 로직 확인
    console.log('\n' + '='.repeat(60));
    console.log('3️⃣ BLE Content 로직 확인 (내일 오늘 데이터 표시)');
    console.log('='.repeat(60));
    
    // 내일 KST 날짜
    const tomorrowKst = new Date(kst);
    tomorrowKst.setDate(tomorrowKst.getDate() + 1);
    const tomorrowYear = tomorrowKst.getFullYear();
    const tomorrowMonth = tomorrowKst.getMonth();
    const tomorrowDay = tomorrowKst.getDate();
    
    console.log('\n📋 BLE Content 로직:');
    console.log('   - 어제 KST 데이터를 오늘 같은 시간에 표시');
    console.log('   - 오늘 KST 데이터를 내일 같은 시간에 표시');
    
    console.log(`\n📅 내일 KST 날짜: ${tomorrowYear}-${String(tomorrowMonth + 1).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')}`);
    console.log(`📅 오늘 KST 날짜: ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`);
    
    console.log('\n⏰ 예상 BLE Content 표시 시간:');
    console.log(`   내일 KST ${tomorrowYear}-${String(tomorrowMonth + 1).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')} 9:30-16:00`);
    console.log(`   → 오늘 KST ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')} 9:30-16:00 데이터 표시`);
    
    // BLE Display 데이터 확인 (오늘 EST 시간에 로깅된 데이터)
    console.log('\n📊 BLE Display 데이터 확인:');
    console.log('   - BLE Display는 실시간으로 로깅됨 (1분 간격)');
    console.log('   - 오늘 EST 9:30-16:00에 로깅된 데이터가 BLE Content에 사용됨');
    
    if (marketHoursData.length > 0) {
      console.log(`\n✅ 오늘 KST 데이터가 있으므로:`);
      console.log(`   1. 오늘 밤 EST 9:30-16:00에 트레이딩 진행`);
      console.log(`   2. 트레이딩 중 BLE Display에 로깅됨`);
      console.log(`   3. 내일 KST 9:30-16:00에 오늘 데이터 표시 (sendBLEReplaySync.js 실행 시)`);
    } else {
      console.log(`\n⚠️ 오늘 KST 데이터가 없으므로 트레이딩 및 BLE Content 생성 불가`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ 확인 완료');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkTodayDataAndTrading();

