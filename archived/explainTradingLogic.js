/* 
1/2일 데이터 기반 트레이딩 로직 설명
*/

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

function determineTradeMood({ lux, temperature, humidity }) {
  const isBright = lux > 20000;
  const isDark = lux <= 20000;
  const isHot = temperature > 15;
  const isCold = temperature < 15;
  const isDry = humidity < 50;
  const isWet = humidity > 50;

  if (isBright && isDry && isHot) return "Hot & Dry";
  if (isBright && isDry && isCold) return "Cold & Bright";
  if (isDark && isWet && isCold) return "Cold & Wet";
  if (isDark && isWet && isHot) return "Hot & Humid";
  if (isBright && isWet && isCold) return "Bright & Wet";
  if (isDark && isDry) return "Dry & Cloudy";
  if (isBright && isDry) return "Bright & Dry";
  if (isDark && isWet) return "Dark & Wet";

  return "Unknown";
}

function normalize(value, min, max) {
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

function getRiskProfile(lux) {
  const luxNorm = normalize(lux, 0, 50000);
  const takeProfit = parseFloat((4 + 4 * luxNorm).toFixed(2)); // 4–8%
  const stopLoss = parseFloat((2 + 2 * luxNorm).toFixed(2));    // 2–4%
  return { takeProfit, stopLoss };
}

function getMaxHoldMinutes(humidity) {
  const humidNorm = normalize(humidity, 0, 100);
  return Math.floor(5 + humidNorm * 40); // 5–45 min
}

function getMoodVolatilityFactor(mood) {
  const moodVolatilityMap = {
    "Bright & Dry": 0.2,
    "Cold & Bright": 0.3,
    "Hot & Dry": 0.1,
    "Hot & Humid": 0.1,
    "Dark & Wet": 0.7,
    "Dry & Cloudy": 0.5,
    "Bright & Wet": 0.3,
    "Cold & Wet": 0.6
  };
  return moodVolatilityMap[mood] || 0.4;
}

function getPositionSize(tempC, accountBalanceUSD, entryPrice, stopLossPct, mood) {
  const tempNorm = normalize(tempC, 0, 40);
  const moodvolatilityFactor = getMoodVolatilityFactor(mood);
  const maxRiskPerTrade = accountBalanceUSD * 0.03 * tempNorm;
  const perShareRisk = entryPrice * (stopLossPct / 100);
  const rawShares = maxRiskPerTrade / perShareRisk;
  const adjustedShares = Math.floor(rawShares * (1 - moodvolatilityFactor));
  return Math.max(1, adjustedShares);
}

function shouldSkipDay(lux, humidity, temperature) {
  return lux < 200 && humidity > 80 && temperature < 7;
}

const moodStockMap = {
  "Bright & Dry": ["MSFT", "GOOG"],
  "Cold & Bright": ["INTC", "IBM"],
  "Hot & Dry": ["SPWR", "SEDG"],
  "Hot & Humid": ["DASH", "UBER"],
  "Dark & Wet": ["NEE", "WM"],
  "Dry & Cloudy": ["PFE", "ABT"],
  "Bright & Wet": ["NKE", "LULU"],
  "Cold & Wet": ["TGT", "COST"]
};

async function explainTradingLogic() {
  await authorizeGoogleSheets();
  const data = await readReplayFeed(500, 'Replay Feed');
  const jan2Data = data.filter(d => {
    const date = new Date(d.tsMs);
    return date.getFullYear() === 2026 && date.getMonth() === 0 && date.getDate() === 2 && date.getHours() >= 13;
  });

  console.log('='.repeat(80));
  console.log('📊 1/2일 오후 1시 이후 트레이딩 로직 분석');
  console.log('='.repeat(80));
  console.log(`\n총 데이터: ${jan2Data.length}개\n`);

  // 샘플 데이터 분석
  const samples = [
    { idx: 1, data: jan2Data[0] },
    { idx: 2, data: jan2Data[1] },
    { idx: 3, data: jan2Data[2] },
    { idx: 4, data: jan2Data[3] },
    { idx: 5, data: jan2Data[4] }
  ];

  samples.forEach(({ idx, data: d }) => {
    if (!d || !d.tsMs) return;
    
    const date = new Date(d.tsMs);
    const mood = determineTradeMood({ lux: d.lux, temperature: d.temperature, humidity: d.humidity });
    const stocks = moodStockMap[mood] || [];
    const { takeProfit, stopLoss } = getRiskProfile(d.lux);
    const maxHold = getMaxHoldMinutes(d.humidity);
    const skip = shouldSkipDay(d.lux, d.humidity, d.temperature);
    
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📅 샘플 ${idx}: ${date.toLocaleString('ko-KR')}`);
    console.log(`   센서 데이터: Lux=${d.lux}, Temp=${d.temperature.toFixed(1)}°C, Humidity=${d.humidity.toFixed(1)}%`);
    
    console.log(`\n1️⃣ 날씨 무드 결정:`);
    console.log(`   - Lux ${d.lux > 20000 ? '> 20000' : '≤ 20000'} → ${d.lux > 20000 ? 'Bright' : 'Dark'}`);
    console.log(`   - Temp ${d.temperature > 15 ? '> 15°C' : '≤ 15°C'} → ${d.temperature > 15 ? 'Hot' : 'Cold'}`);
    console.log(`   - Humidity ${d.humidity < 50 ? '< 50%' : '≥ 50%'} → ${d.humidity < 50 ? 'Dry' : 'Wet'}`);
    console.log(`   → 무드: "${mood}"`);
    
    if (skip) {
      console.log(`\n   ⛔ 거래 스킵: 너무 어둡고 습하고 추움 (Lux < 200, Humidity > 80%, Temp < 7°C)`);
      return;
    }
    
    if (mood === "Cold & Wet") {
      console.log(`\n   ⛔ 거래 스킵: "Cold & Wet" 무드는 거래하지 않음`);
      return;
    }
    
    if (stocks.length === 0) {
      console.log(`\n   ⛔ 거래 스킵: 해당 무드에 매핑된 주식이 없음`);
      return;
    }
    
    console.log(`\n2️⃣ 주식 선택:`);
    console.log(`   → 추천 주식: ${stocks.join(', ')}`);
    
    console.log(`\n3️⃣ 리스크 프로필 (Lux 기반):`);
    console.log(`   - Lux: ${d.lux} → 정규화: ${normalize(d.lux, 0, 50000).toFixed(3)}`);
    console.log(`   - Take Profit: ${takeProfit}% (밝을수록 높음, 4-8%)`);
    console.log(`   - Stop Loss: ${stopLoss}% (밝을수록 높음, 2-4%)`);
    
    console.log(`\n4️⃣ 포지션 크기 (온도 기반):`);
    const tempNorm = normalize(d.temperature, 0, 40);
    const volFactor = getMoodVolatilityFactor(mood);
    console.log(`   - 온도: ${d.temperature.toFixed(1)}°C → 정규화: ${tempNorm.toFixed(3)}`);
    console.log(`   - 무드 변동성 팩터: ${volFactor} (${mood})`);
    console.log(`   - 온도가 높을수록, 변동성이 낮을수록 더 많은 주식 매수`);
    console.log(`   - 예시: $100,000 계정, $100 주가, ${stopLoss}% SL → 약 ${getPositionSize(d.temperature, 100000, 100, stopLoss, mood)}주`);
    
    console.log(`\n5️⃣ 최대 보유 시간 (습도 기반):`);
    console.log(`   - 습도: ${d.humidity.toFixed(1)}% → 정규화: ${normalize(d.humidity, 0, 100).toFixed(3)}`);
    console.log(`   - 최대 보유: ${maxHold}분 (습할수록 오래 보유, 5-45분)`);
    
    console.log(`\n6️⃣ 진입 신호 (Alpaca API에서 확인):`);
    console.log(`   - 각 주식의 최근 5분 캔들스틱 데이터 분석`);
    console.log(`   - 상승 트렌드 (0.5% 이상) → LONG 진입`);
    console.log(`   - 하락 트렌드 (0.5% 이상) → SHORT 진입`);
    console.log(`   - 트렌드 없음 → 랜덤 진입 (50% 확률)`);
    
    console.log(`\n7️⃣ 종료 조건:`);
    console.log(`   - Take Profit 도달 → 즉시 매도`);
    console.log(`   - Stop Loss 도달 → 즉시 매도`);
    console.log(`   - 최대 보유 시간 (${maxHold}분) 초과 → 즉시 매도`);
    console.log(`   - 시장 종료 → 모든 포지션 강제 종료`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log('📋 전체 트레이딩 프로세스 요약:');
  console.log('='.repeat(80));
  console.log(`
1. 센서 데이터 수집 (Lux, Temperature, Humidity)
   ↓
2. 날씨 무드 결정 (Bright/Dark + Hot/Cold + Dry/Wet)
   ↓
3. 무드에 따른 주식 선택 (moodStockMap)
   ↓
4. 거래 스킵 조건 확인 (shouldSkipDay, Cold & Wet)
   ↓
5. 리스크 프로필 계산 (Lux → Take Profit/Stop Loss)
   ↓
6. 포지션 크기 계산 (온도 + 무드 변동성)
   ↓
7. 최대 보유 시간 계산 (습도)
   ↓
8. Alpaca API에서 진입 신호 확인 (5분 캔들스틱 트렌드)
   ↓
9. 거래 실행 (LONG 또는 SHORT)
   ↓
10. 모니터링 (1분마다 TP/SL/최대보유시간 확인)
   ↓
11. 종료 조건 충족 시 포지션 종료
   ↓
12. Alpaca Trades 시트에 기록
  `);
}

explainTradingLogic().catch(console.error);

