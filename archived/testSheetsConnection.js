/* 
Google Sheets 연결 및 데이터 읽기 테스트
*/

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function testSheets() {
  try {
    console.log('🔍 Google Sheets 연결 테스트...\n');
    
    await authorizeGoogleSheets();
    console.log('✅ Google Sheets 인증 성공\n');
    
    console.log('📊 Replay Feed 데이터 읽기 시도...');
    const data = await readReplayFeed(500, 'Replay Feed');
    console.log(`✅ 데이터 로드 완료: ${data.length}개\n`);
    
    if (data.length > 0) {
      console.log('📋 첫 3개 데이터 샘플:');
      data.slice(0, 3).forEach((item, idx) => {
        console.log(`\n${idx + 1}.`);
        console.log(`   - 시간: ${item.tsLocal || new Date(item.tsMs).toLocaleString()}`);
        console.log(`   - Lux: ${item.lux}`);
        console.log(`   - 온도: ${item.temperature}`);
        console.log(`   - 습도: ${item.humidity}`);
        console.log(`   - Power: ${item.power}`);
        console.log(`   - 무드: ${item.mood}`);
      });
    } else {
      console.log('⚠️ 데이터가 없습니다.');
      console.log('   확인 사항:');
      console.log('   1. GOOGLE_SPREADSHEET_ID가 올바른지 확인');
      console.log('   2. "Replay Feed" 시트가 존재하는지 확인');
      console.log('   3. 시트에 데이터가 있는지 확인');
    }
  } catch (error) {
    console.error('❌ 오류:', error.message);
    console.error('Stack:', error.stack);
  }
}

testSheets();

