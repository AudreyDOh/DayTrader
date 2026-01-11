#!/usr/bin/env node
/**
 * Script to check Render.com server status and configuration
 */

const https = require('https');

async function checkRenderStatus() {
  console.log('🔍 Render.com 서버 상태 확인 중...\n');

  // Check 1: API Test endpoint
  try {
    const testResponse = await fetch('https://daytrader.onrender.com/api/test');
    const testData = await testResponse.json();
    console.log('✅ API Test 응답:');
    console.log('   - 서버 상태:', testData.message || 'OK');
    console.log('   - Alpaca 설정:', testData.alpaca_configured ? '✅' : '❌');
    console.log('   - 현재 시간:', testData.timestamp_local);
    console.log('');
  } catch (error) {
    console.error('❌ API Test 실패:', error.message);
    return;
  }

  // Check 2: Ticker endpoint (to see if replay mode is active)
  try {
    const tickerResponse = await fetch('https://daytrader.onrender.com/api/ticker');
    const tickerData = await tickerResponse.json();
    console.log('✅ Ticker API 응답:');
    if (tickerData.messages && tickerData.messages.length > 0) {
      console.log('   - 메시지 수:', tickerData.messages.length);
      console.log('   - 첫 번째 메시지:', tickerData.messages[0].substring(0, 80) + '...');
    } else {
      console.log('   - 메시지 없음');
    }
    console.log('');
  } catch (error) {
    console.error('❌ Ticker API 실패:', error.message);
  }

  console.log('📋 확인 사항:');
  console.log('   1. Render.com 대시보드 → Logs 탭에서 다음을 확인:');
  console.log('      - "🎬 REPLAY MODE ENABLED" 메시지');
  console.log('      - "📊 Loaded X sensor readings" 메시지');
  console.log('      - "🔄 Processing KST" 메시지');
  console.log('');
  console.log('   2. Render.com 대시보드 → Environment 탭에서 확인:');
  console.log('      - REPLAY_MODE=true');
  console.log('      - REPLAY_TRADE=true');
  console.log('      - GOOGLE_CREDENTIALS 설정됨');
  console.log('      - GOOGLE_SPREADSHEET_ID 설정됨');
  console.log('');
  console.log('   3. 서버 재시작 필요할 수 있음:');
  console.log('      - Render.com 대시보드 → "Manual Deploy" 또는 "Restart"');
}

checkRenderStatus().catch(console.error);

