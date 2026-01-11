/**
 * BLE Content를 매 분마다 실시간 데이터로 업데이트
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🔄 BLE Content 자동 업데이트 시작...\n');
console.log('   매 분마다 최신 기상 데이터로 업데이트합니다.\n');
console.log('   중지: Ctrl + C\n');

// 첫 실행
const runUpdate = () => {
  const scriptPath = path.join(__dirname, 'generateBLEContentRealtime.js');
  const child = spawn('node', [scriptPath], {
    stdio: 'inherit',
    cwd: __dirname
  });
  
  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`❌ 업데이트 실패 (코드: ${code})`);
    }
  });
};

// 즉시 실행
runUpdate();

// 매 분마다 실행 (60000ms = 1분)
setInterval(() => {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  console.log(`\n⏰ ${kst.toLocaleString('ko-KR')} - BLE Content 업데이트 중...\n`);
  runUpdate();
}, 60000);

// 종료 처리
process.on('SIGINT', () => {
  console.log('\n\n🛑 BLE Content 자동 업데이트 중지...');
  process.exit(0);
});

