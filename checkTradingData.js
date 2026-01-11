#!/usr/bin/env node
/**
 * Check if today's KST data covers 9:30 AM - 4:00 PM for US market trading
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function checkTradingData() {
  try {
    console.log('🔐 Authorizing Google Sheets...\n');
    await authorizeGoogleSheets();
    
    // Get current date
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    console.log('📅 현재 시간:');
    console.log(`   KST: ${kst.toLocaleString('ko-KR')}\n`);
    
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
    
    // Check data for trading hours: KST 9:30 AM - 4:00 PM
    // This data will be used for EST 9:30 AM - 4:00 PM trading
    const tradingStartHour = 9;
    const tradingStartMinute = 30;
    const tradingEndHour = 16;
    const tradingEndMinute = 0;
    
    const tradingData = todayData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const hour = itemKst.getHours();
      const minute = itemKst.getMinutes();
      
      // Check if time is between 9:30 AM and 4:00 PM
      if (hour < tradingStartHour) return false;
      if (hour === tradingStartHour && minute < tradingStartMinute) return false;
      if (hour > tradingEndHour) return false;
      if (hour === tradingEndHour && minute > tradingEndMinute) return false;
      
      return true;
    });
    
    console.log(`🔍 트레이딩 시간대 데이터 (KST 9:30 AM - 4:00 PM):`);
    console.log(`   필요: KST 9:30 ~ 16:00 데이터`);
    console.log(`   실제: ${tradingData.length}개\n`);
    
    if (tradingData.length > 0) {
      const first = new Date(tradingData[0].tsMs);
      const last = new Date(tradingData[tradingData.length - 1].tsMs);
      const firstKst = new Date(first.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const lastKst = new Date(last.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      
      console.log(`   시간 범위: ${firstKst.getHours()}:${String(firstKst.getMinutes()).padStart(2,'0')} ~ ${lastKst.getHours()}:${String(lastKst.getMinutes()).padStart(2,'0')} KST`);
      console.log(`   샘플 (9:30): ${tradingData.find(d => {
        const dKst = new Date(new Date(d.tsMs).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        return dKst.getHours() === 9 && dKst.getMinutes() >= 30;
      })?.lux || 'N/A'}`);
      console.log(`   샘플 (16:00): ${tradingData.find(d => {
        const dKst = new Date(new Date(d.tsMs).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        return dKst.getHours() === 16 && dKst.getMinutes() === 0;
      })?.lux || 'N/A'}\n`);
      
      // Check coverage by hour
      console.log(`📈 시간대별 데이터:`);
      for (let h = 9; h <= 16; h++) {
        const hourData = tradingData.filter(item => {
          const itemDate = new Date(item.tsMs);
          const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          return itemKst.getHours() === h;
        });
        const timeLabel = h === 9 ? '9:30-9:59' : h === 16 ? '16:00' : `${h}:00-${h}:59`;
        console.log(`   ${timeLabel.padEnd(10)}: ${hourData.length}개`);
      }
      
      console.log(`\n✅ 트레이딩 가능:`);
      console.log(`   KST ${firstKst.getHours()}:${String(firstKst.getMinutes()).padStart(2,'0')} ~ ${lastKst.getHours()}:${String(lastKst.getMinutes()).padStart(2,'0')} 데이터`);
      console.log(`   → EST ${firstKst.getHours()}:${String(firstKst.getMinutes()).padStart(2,'0')} ~ ${lastKst.getHours()}:${String(lastKst.getMinutes()).padStart(2,'0')} 트레이딩에 사용`);
    } else {
      console.log(`   ❌ 트레이딩 시간대 데이터 없음`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  checkTradingData();
}

module.exports = { checkTradingData };

