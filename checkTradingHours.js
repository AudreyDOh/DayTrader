#!/usr/bin/env node
/**
 * Check if today's KST data covers US market trading hours
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function checkTradingHours() {
  try {
    console.log('🔐 Authorizing Google Sheets...\n');
    await authorizeGoogleSheets();
    
    // Get current date
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    console.log('📅 현재 시간:');
    console.log(`   KST: ${kst.toLocaleString('ko-KR')}`);
    console.log(`   EST: ${est.toLocaleString('en-US')}\n`);
    
    // Today's KST date
    const todayKst = new Date(kst);
    const todayYear = todayKst.getFullYear();
    const todayMonth = todayKst.getMonth();
    const todayDay = todayKst.getDate();
    
    console.log('📖 Reading Replay Feed data...\n');
    const allData = await readReplayFeed(10000, 'Replay Feed');
    
    // Filter for today (1/7 KST)
    const todayData = allData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return (
        itemKst.getFullYear() === todayYear &&
        itemKst.getMonth() === todayMonth &&
        itemKst.getDate() === todayDay
      );
    }).sort((a, b) => a.tsMs - b.tsMs);
    
    console.log(`📊 오늘(1/7) 데이터: ${todayData.length}개\n`);
    
    if (todayData.length === 0) {
      console.log('❌ 오늘(1/7) 데이터가 없습니다!');
      return;
    }
    
    // Show time range
    const first = new Date(todayData[0].tsMs);
    const last = new Date(todayData[todayData.length - 1].tsMs);
    const firstKst = new Date(first.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const lastKst = new Date(last.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    console.log(`⏰ 데이터 시간 범위:`);
    console.log(`   시작: ${firstKst.toLocaleString('ko-KR')} KST`);
    console.log(`   종료: ${lastKst.toLocaleString('ko-KR')} KST\n`);
    
    // US Market hours: EST 9:30 AM - 4:00 PM
    // Convert to KST: EST 9:30 AM = KST 11:30 PM (previous day) or 10:30 PM (DST)
    // EST 4:00 PM = KST 6:00 AM (next day) or 5:00 AM (DST)
    
    // For 1/7 EST market:
    // EST 1/7 9:30 AM = KST 1/7 11:30 PM (or 10:30 PM)
    // EST 1/7 4:00 PM = KST 1/8 6:00 AM (or 5:00 AM)
    
    // Check if we have data for US market hours
    // We need KST 1/7 23:30 (or 22:30) ~ KST 1/8 06:00 (or 05:00)
    // But we're only checking 1/7 data, so we need KST 1/7 23:30 (or 22:30) ~ KST 1/7 23:59
    
    const marketOpenKstHour = 23; // 11 PM KST
    const marketOpenKstMinute = 30; // 30 minutes
    
    // Check if we have data around market open time
    const marketOpenData = todayData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return itemKst.getHours() === marketOpenKstHour && itemKst.getMinutes() >= marketOpenKstMinute;
    });
    
    console.log(`🔍 미국 시장 개장 시간 (EST 9:30 AM = KST 11:30 PM):`);
    if (marketOpenData.length > 0) {
      console.log(`   ✅ 데이터 있음: ${marketOpenData.length}개`);
      console.log(`   샘플: ${new Date(marketOpenData[0].tsMs).toLocaleString('ko-KR')} KST`);
      console.log(`   Lux=${marketOpenData[0].lux}, Temp=${marketOpenData[0].temperature}, Power=${marketOpenData[0].power}`);
    } else {
      console.log(`   ⚠️ 데이터 없음`);
      console.log(`   → 가장 늦은 데이터: ${lastKst.toLocaleString('ko-KR')} KST`);
    }
    
    // Check data coverage for trading hours
    console.log(`\n📈 트레이딩 시간대 데이터 커버리지:`);
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const hourData = todayData.filter(item => {
        const itemDate = new Date(item.tsMs);
        const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        return itemKst.getHours() === h;
      });
      if (hourData.length > 0) {
        hours.push(`${h}시 (${hourData.length}개)`);
      }
    }
    console.log(`   데이터가 있는 시간대: ${hours.join(', ')}`);
    
    // Summary
    console.log(`\n📋 요약:`);
    console.log(`   오늘(1/7) 한국 데이터: ${todayData.length}개`);
    console.log(`   시간 범위: ${firstKst.getHours()}:${String(firstKst.getMinutes()).padStart(2,'0')} ~ ${lastKst.getHours()}:${String(lastKst.getMinutes()).padStart(2,'0')} KST`);
    
    if (lastKst.getHours() >= 23 || (lastKst.getHours() === 22 && lastKst.getMinutes() >= 30)) {
      console.log(`   ✅ 미국 시장 개장 시간(EST 9:30 AM = KST 11:30 PM) 데이터 있음`);
    } else {
      console.log(`   ⚠️ 미국 시장 개장 시간 데이터 부족 (가장 늦은 데이터: ${lastKst.getHours()}:${String(lastKst.getMinutes()).padStart(2,'0')} KST)`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  checkTradingHours();
}

module.exports = { checkTradingHours };

