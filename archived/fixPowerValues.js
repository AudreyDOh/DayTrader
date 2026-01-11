#!/usr/bin/env node
/**
 * Fix Power values in Replay Feed sheet to be positive
 */

require('dotenv').config();
const { authorizeGoogleSheets } = require('./logToSheets');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
let sheets = null;

async function fixPowerValues() {
  try {
    await authorizeGoogleSheets();
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS.includes('{') 
        ? process.env.GOOGLE_CREDENTIALS 
        : Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    // Read all data
    console.log('📖 Reading Replay Feed data...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Replay Feed!A:J'
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    console.log(`✅ Found ${rows.length} rows`);

    // Find rows with power = 0 (column H, index 7)
    const rowsToUpdate = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row.length > 7) {
        const power = parseFloat(row[7]) || 0;
        if (power === 0) {
          rowsToUpdate.push({
            rowIndex: i + 1, // 1-indexed
            row: row
          });
        }
      }
    }

    console.log(`\n📊 Power = 0인 행: ${rowsToUpdate.length}개`);

    if (rowsToUpdate.length === 0) {
      console.log('✅ 모든 Power 값이 양수입니다!');
      return;
    }

    // Update power values to 0.01
    console.log(`\n🔧 Power 값을 0.01로 수정 중...`);
    const batchSize = 100; // Google Sheets API limit
    
    for (let i = 0; i < rowsToUpdate.length; i += batchSize) {
      const batch = rowsToUpdate.slice(i, i + batchSize);
      const updates = batch.map(item => ({
        range: `Replay Feed!H${item.rowIndex}`,
        values: [[0.01]]
      }));

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });

      console.log(`   ✅ ${Math.min(i + batchSize, rowsToUpdate.length)}/${rowsToUpdate.length} 행 업데이트 완료`);
    }

    console.log(`\n✅ 완료! ${rowsToUpdate.length}개 행의 Power 값을 0.01로 수정했습니다.`);
    console.log('   이제 서버를 재시작하면 트레이딩이 시작될 수 있습니다.');
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixPowerValues();

