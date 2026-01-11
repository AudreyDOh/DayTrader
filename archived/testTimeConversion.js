/* 
시간 변환 테스트: 한국 시간 → 미국 시간 (같은 날짜, 같은 시:분)
*/

// 한국 시간 1/2 오후 1:00을 미국 시간 1/2 오후 1:00으로 변환
const kstTime = new Date('2026-01-02T13:00:00+09:00'); // 한국 시간 1/2 오후 1:00
console.log('한국 시간:', kstTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));

// 한국 시간에서 날짜와 시:분 추출
const kstYear = kstTime.getFullYear();
const kstMonth = kstTime.getMonth();
const kstDate = kstTime.getDate();
const kstHour = kstTime.getHours();
const kstMinute = kstTime.getMinutes();
const kstSecond = kstTime.getSeconds();

console.log(`추출: ${kstYear}-${kstMonth+1}-${kstDate} ${kstHour}:${kstMinute}:${kstSecond}`);

// 미국 동부 시간으로 같은 날짜, 같은 시:분으로 변환
const estTime = new Date(Date.UTC(
  kstYear,
  kstMonth,
  kstDate,
  kstHour,
  kstMinute,
  kstSecond
));
// UTC로 만든 후 미국 동부 시간으로 변환
const estTimeString = estTime.toLocaleString('en-US', { 
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

console.log('미국 동부 시간:', estTimeString);

// 더 정확한 방법: 미국 동부 시간대에서 직접 생성
const estTime2 = new Date(`2026-01-02T13:00:00-05:00`); // EST (또는 -04:00 for EDT)
console.log('미국 동부 시간 (직접):', estTime2.toLocaleString('en-US', { timeZone: 'America/New_York' }));

// 한국 시간으로 변환하면?
console.log('한국 시간으로 변환:', estTime2.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));

