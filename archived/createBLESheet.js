#!/usr/bin/env node
/**
 * Script to create BLE Display sheet with headers in Google Sheets
 */

require('dotenv').config();
const { authorizeGoogleSheets, createBLEDisplaySheet } = require('./logToSheets');

async function main() {
  try {
    console.log('🔐 Authorizing Google Sheets...');
    await authorizeGoogleSheets();
    
    console.log('📋 Creating BLE Display sheet...');
    const success = await createBLEDisplaySheet('BLE Display');
    
    if (success) {
      console.log('✅ BLE Display sheet created successfully!');
      console.log('📊 Sheet name: "BLE Display"');
      console.log('📝 Total columns: 44');
      console.log('\nYou can now start logging BLE display data to this sheet.');
    } else {
      console.log('⚠️ Sheet creation may have failed');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

