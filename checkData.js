#!/usr/bin/env node
/**
 * Check if sensor data exists for January 7th, 2026
 */

require('dotenv').config();
const { authorizeGoogleSheets, readReplayFeed } = require('./logToSheets');

async function checkData() {
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
    
    // Check for today's data (1/7 KST)
    const todayKst = new Date(kst);
    const todayYear = todayKst.getFullYear();
    const todayMonth = todayKst.getMonth();
    const todayDay = todayKst.getDate();
    
    // Check for yesterday's data (1/6 KST)
    const yesterdayKst = new Date(kst);
    yesterdayKst.setDate(yesterdayKst.getDate() - 1);
    const yesterdayYear = yesterdayKst.getFullYear();
    const yesterdayMonth = yesterdayKst.getMonth();
    const yesterdayDay = yesterdayKst.getDate();
    
    console.log('📖 Reading Replay Feed data...\n');
    const allData = await readReplayFeed(10000, 'Replay Feed');
    
    if (allData.length === 0) {
      console.log('❌ No data found in Replay Feed sheet');
      return;
    }
    
    console.log(`✅ Total entries in Replay Feed: ${allData.length}\n`);
    
    // Filter for today (1/7 KST)
    const todayData = allData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return (
        itemKst.getFullYear() === todayYear &&
        itemKst.getMonth() === todayMonth &&
        itemKst.getDate() === todayDay
      );
    });
    
    // Filter for yesterday (1/6 KST)
    const yesterdayData = allData.filter(item => {
      const itemDate = new Date(item.tsMs);
      const itemKst = new Date(itemDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      return (
        itemKst.getFullYear() === yesterdayYear &&
        itemKst.getMonth() === yesterdayMonth &&
        itemKst.getDate() === yesterdayDay
      );
    });
    
    console.log(`📊 오늘 데이터 (${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')} KST): ${todayData.length} entries`);
    if (todayData.length > 0) {
      const first = new Date(todayData[0].tsMs);
      const last = new Date(todayData[todayData.length - 1].tsMs);
      console.log(`   시간 범위: ${first.toLocaleString('ko-KR')} ~ ${last.toLocaleString('ko-KR')}`);
      console.log(`   샘플: Lux=${todayData[0].lux}, Temp=${todayData[0].temperature}, Power=${todayData[0].power}`);
    }
    
    console.log(`\n📊 어제 데이터 (${yesterdayYear}-${String(yesterdayMonth + 1).padStart(2, '0')}-${String(yesterdayDay).padStart(2, '0')} KST): ${yesterdayData.length} entries`);
    if (yesterdayData.length > 0) {
      const first = new Date(yesterdayData[0].tsMs);
      const last = new Date(yesterdayData[yesterdayData.length - 1].tsMs);
      console.log(`   시간 범위: ${first.toLocaleString('ko-KR')} ~ ${last.toLocaleString('ko-KR')}`);
      console.log(`   샘플: Lux=${yesterdayData[0].lux}, Temp=${yesterdayData[0].temperature}, Power=${yesterdayData[0].power}`);
    }
    
    // Show available dates
    const dates = new Set();
    allData.forEach(d => {
      const date = new Date(d.tsMs);
      const kstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      dates.add(`${kstDate.getFullYear()}-${String(kstDate.getMonth() + 1).padStart(2, '0')}-${String(kstDate.getDate()).padStart(2, '0')}`);
    });
    const sortedDates = Array.from(dates).sort();
    console.log(`\n📅 사용 가능한 날짜 (총 ${dates.size}일):`);
    sortedDates.forEach(date => console.log(`   - ${date}`));
    
    // Current logic check
    console.log(`\n🔍 현재 트레이딩 로직:`);
    console.log(`   오늘 KST: ${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`);
    console.log(`   어제 KST: ${yesterdayYear}-${String(yesterdayMonth + 1).padStart(2, '0')}-${String(yesterdayDay).padStart(2, '0')}`);
    console.log(`   → 현재 코드는 어제(${yesterdayYear}-${String(yesterdayMonth + 1).padStart(2, '0')}-${String(yesterdayDay).padStart(2, '0')}) 데이터로 어제 EST 트레이딩을 합니다.`);
    
    if (todayData.length > 0) {
      console.log(`\n✅ 오늘(1/7) 데이터가 있습니다!`);
      console.log(`   → 오늘 데이터로 오늘 EST 트레이딩을 하려면 코드 수정이 필요합니다.`);
    } else {
      console.log(`\n⚠️ 오늘(1/7) 데이터가 없습니다.`);
      console.log(`   → 현재 로직대로 어제(1/6) 데이터로 어제 EST 트레이딩을 진행합니다.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  checkData();
}

module.exports = { checkData };

