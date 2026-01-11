#!/usr/bin/env node
/**
 * Script to encode Google credentials to base64 for Render.com
 */

const fs = require('fs');
const path = require('path');

const credentialsPath = path.join(__dirname, 'credentials.json');

if (!fs.existsSync(credentialsPath)) {
  console.error('❌ credentials.json 파일을 찾을 수 없습니다.');
  console.error('   현재 디렉토리:', __dirname);
  process.exit(1);
}

try {
  // Read credentials file
  const credentialsContent = fs.readFileSync(credentialsPath, 'utf8');
  
  // Validate JSON
  JSON.parse(credentialsContent);
  
  // Encode to base64
  const base64Encoded = Buffer.from(credentialsContent).toString('base64');
  
  console.log('✅ Google Credentials Base64 인코딩 완료!\n');
  console.log('📋 Render.com Environment Variables 설정:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nKey: GOOGLE_CREDENTIALS');
  console.log('Value: (아래 전체 문자열을 복사하세요)\n');
  console.log(base64Encoded);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n💡 사용 방법:');
  console.log('   1. 위의 base64 문자열 전체를 복사');
  console.log('   2. Render.com 대시보드 → Environment 탭 이동');
  console.log('   3. Key: GOOGLE_CREDENTIALS');
  console.log('   4. Value: (복사한 문자열 붙여넣기)');
  console.log('   5. 저장 후 서버 재시작\n');
  
} catch (error) {
  console.error('❌ 오류 발생:', error.message);
  if (error instanceof SyntaxError) {
    console.error('   credentials.json 파일의 JSON 형식이 잘못되었습니다.');
  }
  process.exit(1);
}

