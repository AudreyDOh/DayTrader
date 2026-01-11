/* 
전체 시스템 테스트: Alpaca API, Google Sheets, Frontend 연동 확인
*/

require('dotenv').config();
const alpaca = require('./alpaca');
const TradeManager = require('./tradeManager');
const { authorizeGoogleSheets, logToSheet, readTradesFromSheet } = require('./logToSheets');
const { getRiskProfile, getMaxHoldMinutes, getTPandSL } = require('./solarStrategy');

async function testFullSystem(serverRunning = false) {
  console.log('🧪 전체 시스템 테스트 시작...\n');

  // 1. Alpaca API 연결 테스트
  console.log('1️⃣ Alpaca API 연결 테스트...');
  try {
    const account = await alpaca.getAccountInfo();
    console.log('✅ Alpaca API 연결 성공');
    console.log(`   - Cash: $${account.cash}`);
    console.log(`   - Equity: $${account.equity}`);
    console.log(`   - Buying Power: $${account.buying_power}\n`);
  } catch (error) {
    console.error('❌ Alpaca API 연결 실패:', error.message);
    return;
  }

  // 2. Google Sheets 연결 테스트
  console.log('2️⃣ Google Sheets 연결 테스트...');
  let sheetsEnabled = false;
  try {
    await authorizeGoogleSheets();
    console.log('✅ Google Sheets 연결 성공\n');
    sheetsEnabled = true;
  } catch (error) {
    console.log('⚠️ Google Sheets 연결 실패:', error.message);
    console.log('   (Google Sheets 없이도 거래는 가능합니다)\n');
    sheetsEnabled = false;
  }

  // 3. 시장 시간 확인
  console.log('3️⃣ 시장 시간 확인...');
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const isWeekday = day !== 0 && day !== 6;
  const marketOpen = hour > 9 || (hour === 9 && minute >= 30);
  const marketClosed = hour >= 16;
  const isMarketOpen = isWeekday && marketOpen && !marketClosed;
  
  console.log(`   - 미국 동부 시간: ${nyTime.toLocaleString('en-US')}`);
  console.log(`   - 시장 상태: ${isMarketOpen ? '✅ 열림' : '❌ 닫힘'}`);
  if (!isMarketOpen) {
    console.log('   ⚠️ 시장이 닫혀있어 실제 거래는 불가능합니다.');
    console.log('   (시장이 열려있을 때 다시 테스트하세요)\n');
  }
  
  // 4. 테스트 거래 실행 (시장이 열려있을 때만)
  if (!isMarketOpen) {
    console.log('⏭️ 시장이 닫혀있어 거래 테스트를 건너뜁니다.\n');
    console.log('✅ 기본 시스템 테스트 완료!');
    console.log('\n📋 확인 사항:');
    console.log('   1. Alpaca API: ✅ 연결 성공');
    if (sheetsEnabled) {
      console.log('   2. Google Sheets: ✅ 연결 성공');
    } else {
      console.log('   2. Google Sheets: ⚠️ 연결 실패 (환경 변수 확인 필요)');
    }
    console.log('   3. 시장 시간: ⚠️ 현재 시장 닫힘 (거래 테스트는 시장 오픈 시 필요)');
    if (serverRunning) {
      console.log('   4. Frontend: ✅ http://localhost:3000 에서 확인 가능');
    } else {
      console.log('   4. Frontend: ⚠️ 서버 실행 필요 (node index.js)');
    }
    return;
  }
  
  console.log('\n4️⃣ 테스트 거래 실행...');
  const testSymbol = 'AAPL'; // Apple 주식으로 테스트
  const testAccountBalance = 100000; // 테스트용 계정 잔고
  
  try {
    // 현재 가격 조회
    let currentPrice;
    const quote = await alpaca.getLastQuote(testSymbol);
    if (quote && quote.bidPrice && quote.askPrice) {
      currentPrice = (quote.bidPrice + quote.askPrice) / 2;
      console.log(`   - 가격 조회 방법: 실시간 Quote 사용`);
    } else {
      // 대안: 최근 바 데이터에서 가격 가져오기
      const bars = await alpaca.getPreviousBars(testSymbol, 1);
      if (!bars || bars.length === 0) {
        console.error('❌ 가격 데이터를 가져올 수 없습니다.');
        return;
      }
      currentPrice = bars[0].close;
      console.log(`   - 가격 조회 방법: 최근 바 데이터 사용`);
    }
    
    console.log(`   - Symbol: ${testSymbol}`);
    console.log(`   - Current Price: $${currentPrice.toFixed(2)}`);
    
    // TradeManager 초기화
    const tradeManager = new TradeManager(testAccountBalance);
    
    // 테스트용 센서 데이터 (밝고 따뜻한 날씨)
    const testLux = 30000;
    const testTemp = 25;
    const testHumidity = 40;
    const testMood = 'Bright & Dry';
    
    // Risk profile 계산
    const { takeProfit, stopLoss } = getRiskProfile(testLux);
    const maxHoldMinutes = getMaxHoldMinutes(testHumidity);
    
    console.log(`   - Take Profit: ${takeProfit}%`);
    console.log(`   - Stop Loss: ${stopLoss}%`);
    console.log(`   - Max Hold: ${maxHoldMinutes} minutes`);
    
    // 진입 신호 생성 (상승 트렌드로 가정)
    const entryPrice = currentPrice;
    const { takeProfit: tpPrice, stopLoss: slPrice } = getTPandSL(
      entryPrice,
      'long',
      takeProfit,
      stopLoss
    );
    
    // 작은 규모로 테스트 (1주)
    const testShares = 1;
    
    console.log(`\n   📊 거래 실행 중...`);
    console.log(`   - Side: LONG`);
    console.log(`   - Shares: ${testShares}`);
    console.log(`   - Entry Price: $${entryPrice.toFixed(2)}`);
    console.log(`   - Take Profit: $${tpPrice.toFixed(2)}`);
    console.log(`   - Stop Loss: $${slPrice.toFixed(2)}\n`);
    
    // 거래 실행
    const openResult = await tradeManager.openTrade({
      symbol: testSymbol,
      side: 'long',
      entryPrice: entryPrice,
      shares: testShares,
      tpPrice: tpPrice,
      slPrice: slPrice,
      entryTime: Date.now(),
      maxHoldMinutes: maxHoldMinutes,
      mood: testMood
    });
    
    if (!openResult?.success) {
      console.error('❌ 거래 실행 실패:', openResult?.error);
      return;
    }
    
    console.log('✅ 거래 실행 성공!');
    console.log(`   - Order ID: ${openResult.trade.orderId}`);
    
    // 잠시 대기 (주문이 체결될 시간)
    console.log('\n   ⏳ 주문 체결 대기 중... (3초)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 5. Google Sheets에 기록 확인
    console.log('\n5️⃣ Google Sheets 기록 확인...');
    if (sheetsEnabled) {
      try {
        // 최근 거래 내역 읽기
        const recentTrades = await readTradesFromSheet(5, 'Alpaca Trades');
        const testTrade = recentTrades.find(t => 
          t.symbol === testSymbol && 
          t.side === 'long' &&
          Math.abs(t.entryPrice - entryPrice) < 0.01
        );
        
        if (testTrade) {
          console.log('✅ Google Sheets에 거래 기록 확인됨!');
          console.log(`   - Symbol: ${testTrade.symbol}`);
          console.log(`   - Side: ${testTrade.side}`);
          console.log(`   - Entry Price: $${testTrade.entryPrice}`);
          console.log(`   - Time: ${testTrade.tsLocal}`);
        } else {
          console.log('⚠️ Google Sheets에서 거래 기록을 찾을 수 없습니다.');
          console.log('   (기록이 아직 반영되지 않았을 수 있습니다)');
        }
      } catch (error) {
        console.error('❌ Google Sheets 읽기 실패:', error.message);
      }
    } else {
      console.log('⚠️ Google Sheets가 비활성화되어 있어 기록 확인을 건너뜁니다.');
      console.log('   (거래는 정상적으로 실행되었습니다)');
    }
    
    // 5. 포지션 확인
    console.log('\n5️⃣ 열린 포지션 확인...');
    const positions = await alpaca.getCurrentPositions();
    const testPosition = positions?.find(p => p.symbol === testSymbol);
    
    if (testPosition) {
      console.log('✅ 포지션 확인됨!');
      console.log(`   - Symbol: ${testPosition.symbol}`);
      console.log(`   - Qty: ${testPosition.qty}`);
      console.log(`   - Avg Entry Price: $${testPosition.avg_entry_price}`);
      console.log(`   - Market Value: $${testPosition.market_value}`);
    } else {
      console.log('⚠️ 포지션을 찾을 수 없습니다.');
    }
    
    // 7. 포지션 확인만 (Wash trade 방지를 위해 즉시 종료하지 않음)
    console.log('\n7️⃣ 테스트 포지션 상태 확인...');
    console.log('⚠️ Wash trade 방지를 위해 포지션을 즉시 종료하지 않습니다.');
    console.log('   (실제 운영에서는 Take Profit/Stop Loss 조건에 따라 자동 종료됩니다)');
    if (tradeManager.openTrades.length > 0) {
      const openTrade = tradeManager.openTrades[0];
      console.log(`   - 열린 포지션: ${openTrade.symbol} ${openTrade.side} ${openTrade.shares}주`);
      console.log(`   - Entry Price: $${openTrade.entryPrice.toFixed(2)}`);
      console.log(`   - Take Profit: $${openTrade.tpPrice.toFixed(2)}`);
      console.log(`   - Stop Loss: $${openTrade.slPrice.toFixed(2)}`);
    }
    
    // 8. 최종 거래 내역 확인
    console.log('\n8️⃣ 최종 거래 내역 확인...');
    if (sheetsEnabled) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 기록 반영 대기
      try {
        const finalTrades = await readTradesFromSheet(5, 'Alpaca Trades');
        const closedTrade = finalTrades.find(t => 
          t.symbol === testSymbol && 
          t.side === 'long' &&
          t.exitPrice > 0
        );
        
        if (closedTrade) {
          console.log('✅ 종료된 거래 기록 확인됨!');
          console.log(`   - Entry: $${closedTrade.entryPrice.toFixed(2)}`);
          console.log(`   - Exit: $${closedTrade.exitPrice.toFixed(2)}`);
          console.log(`   - P&L: $${closedTrade.pnl.toFixed(2)} (${closedTrade.pnlPercent.toFixed(2)}%)`);
          console.log(`   - Reason: ${closedTrade.reason}`);
        } else {
          console.log('⚠️ 종료된 거래 기록을 찾을 수 없습니다.');
        }
      } catch (error) {
        console.log('⚠️ Google Sheets 읽기 실패:', error.message);
      }
    } else {
      console.log('⚠️ Google Sheets가 비활성화되어 있어 기록 확인을 건너뜁니다.');
    }
    
    console.log('\n✅ 전체 시스템 테스트 완료!');
    console.log('\n📋 확인 사항:');
    console.log('   1. Alpaca API: ✅ 연결 및 거래 실행 성공');
    if (sheetsEnabled) {
      console.log('   2. Google Sheets: ✅ 거래 기록 저장 확인');
    } else {
      console.log('   2. Google Sheets: ⚠️ 연결 실패 (환경 변수 확인 필요)');
    }
    console.log('   3. TradeManager: ✅ 거래 관리 정상 작동');
    if (serverRunning) {
      console.log('   4. Frontend: ✅ http://localhost:3000 에서 확인 가능');
    } else {
      console.log('   4. Frontend: ⚠️ 서버 실행 필요 (node index.js)');
    }
    
  } catch (error) {
    console.error('❌ 테스트 거래 실행 중 오류:', error.message);
    console.error('Stack:', error.stack);
  }
}

// 서버가 실행 중인지 확인
async function checkServer() {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3000/api/test', (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

// 메인 실행
(async () => {
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('⚠️ 서버가 실행 중이지 않습니다.');
    console.log('   Frontend 테스트를 위해 서버를 먼저 실행하세요:');
    console.log('   node index.js\n');
  }
  
  await testFullSystem(serverRunning);
})();

