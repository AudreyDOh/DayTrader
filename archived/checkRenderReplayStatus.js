#!/usr/bin/env node
/**
 * Script to check if Render.com server has REPLAY_MODE enabled
 * and diagnose why "Processing KST" logs are missing
 */

async function checkRenderReplayStatus() {
  console.log('🔍 Render.com Replay Mode 상태 확인\n');

  // Check if we can detect replay mode from API responses
  try {
    const testResponse = await fetch('https://daytrader.onrender.com/api/test');
    const testData = await testResponse.json();
    
    console.log('✅ 서버 응답 확인:');
    console.log('   - 서버 상태:', testData.message);
    console.log('   - Alpaca 설정:', testData.alpaca_configured ? '✅' : '❌');
    console.log('');
    
    // Check ticker endpoint for clues
    const tickerResponse = await fetch('https://daytrader.onrender.com/api/ticker');
    const tickerData = await tickerResponse.json();
    
    console.log('📊 Ticker 데이터:');
    if (tickerData.messages && tickerData.messages.length > 0) {
      const msg = tickerData.messages[0];
      console.log('   - 메시지:', msg.substring(0, 100));
      
      // Check if it looks like replay mode (should have sensor data)
      if (msg.includes('LUX') && msg.includes('TEMP')) {
        console.log('   - ✅ 센서 데이터 표시 중 (정상)');
      } else {
        console.log('   - ⚠️ 센서 데이터 없음');
      }
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ API 호출 실패:', error.message);
    return;
  }

  console.log('🔧 Render.com에서 확인해야 할 사항:\n');
  console.log('1️⃣ Environment Variables (환경 변수) 확인:');
  console.log('   Render.com 대시보드 → Environment 탭에서:');
  console.log('   ✅ REPLAY_MODE=true (필수)');
  console.log('   ✅ REPLAY_TRADE=true (필수)');
  console.log('   ✅ GOOGLE_CREDENTIALS=<base64 인코딩된 값>');
  console.log('   ✅ GOOGLE_SPREADSHEET_ID=<스프레드시트 ID>');
  console.log('');
  
  console.log('2️⃣ Logs 확인:');
  console.log('   Render.com 대시보드 → Logs 탭에서 다음 메시지 찾기:');
  console.log('   ✅ "🎬 Starting replay mode..."');
  console.log('   ✅ "📊 Loaded X sensor readings..."');
  console.log('   ✅ "🔄 Processing KST..." (시장 시간에만 나타남)');
  console.log('');
  
  console.log('3️⃣ 서버 재시작:');
  console.log('   환경 변수를 변경했다면 반드시 재시작 필요:');
  console.log('   - Render.com 대시보드 → "Manual Deploy" 클릭');
  console.log('   - 또는 "Restart" 버튼 클릭');
  console.log('');
  
  console.log('4️⃣ 현재 시간 확인:');
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = est.getHours();
  const minute = est.getMinutes();
  const isWeekday = est.getDay() !== 0 && est.getDay() !== 6;
  const isMarketHours = isWeekday && hour >= 9 && hour < 16 && (hour > 9 || minute >= 30);
  
  console.log(`   현재 EST: ${est.toLocaleString('en-US')}`);
  console.log(`   시장 상태: ${isMarketHours ? '✅ 열림 (Processing KST 로그 나타남)' : '❌ 닫힘 (로그 없음 정상)'}`);
  console.log('');
  
  if (!isMarketHours) {
    console.log('💡 참고: 시장이 닫혀있으면 "Processing KST" 로그가 나타나지 않습니다.');
    console.log('   시장이 열릴 때 (EST 9:30 AM - 4:00 PM) 다시 확인하세요.');
  }
}

checkRenderReplayStatus().catch(console.error);

