/* 
Logs all data to Google Sheets
*/

const fs = require('fs');
const { google } = require('googleapis');

let sheetsClient; // reused after auth

async function authorizeGoogleSheets() {
  const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf-8');
  const credentials = JSON.parse(decoded);
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient(); // ✅ moved inside the function
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });

  console.log('✅ Google Sheets authorized');
}

// === Sheet Settings ===
const SPREADSHEET_ID = '17Ndze2nyYslKJbkk56TLFSaRA529qHt2g-UioANmuGU';

// ✅ Accept optional sheet name argument
async function logToSheet(values, sheetName = 'DayTrader Log') {
  if (!sheetsClient) {
    console.error('❌ Sheets client not initialized. Call authorizeGoogleSheets() first.');
    return;
  }

  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });

    // console.log(`📝 Logged to Google Sheets tab '${sheetName}'`);
  } catch (err) {
    console.error('❌ Failed to log to Google Sheets:', err.message);
  }
}

// Read the most recent N rows from a sheet to seed history
async function readRecentFromSheet(limit = 50, sheetName = 'DayTrader Log') {
  if (!sheetsClient) {
    console.error('❌ Sheets client not initialized. Call authorizeGoogleSheets() first.');
    return [];
  }
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:I`, // matches appended columns
      majorDimension: 'ROWS'
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return [];
    const recent = rows.slice(-limit).reverse(); // newest first
    // Map to formatted objects expected by frontend
    return recent.map(r => {
      const [
        time,      // A
        lux,       // B
        temperature, // C
        humidity,  // D
        current,   // E
        power,     // F
        battery,   // G
        mood,      // H
        // stocks // I (unused here)
      ] = r;
      return {
        time: time || '—',
        temperature: temperature ?? '—',
        humidity: humidity ?? '—',
        lux: lux ?? '—',
        current: current ?? '—',
        power: power ?? '—',
        battery: battery ?? '—',
        mood: mood ?? '—'
      };
    });
  } catch (err) {
    console.error('❌ Failed to read from Google Sheets:', err.message);
    return [];
  }
}

// Read replay feed with raw timestamp column preserved (A: tsMs)
async function readReplayFeed(limit = 500, sheetName = 'Replay Feed') {
  if (!sheetsClient) {
    console.error('❌ Sheets client not initialized. Call authorizeGoogleSheets() first.');
    return [];
  }
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:J`,
      majorDimension: 'ROWS'
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return [];
    // Keep newest first (sheets are append-only). We'll sort in caller if needed.
    const recent = rows.slice(-limit).reverse();
    return recent
      .map(r => {
        const [
          tsMs,          // A (number-like, ms)
          tsIso,         // B (ISO)
          tsLocal,       // C (local string)
          lux,           // D
          temperature,   // E
          humidity,      // F
          current,       // G
          power,         // H
          battery,       // I
          mood           // J
        ] = r;
        const parsedTs = Number(tsMs);
        return {
          tsMs: Number.isFinite(parsedTs) ? parsedTs : null,
          tsIso: tsIso ?? null,
          tsLocal: tsLocal ?? null,
          lux: lux ?? '—',
          temperature: temperature ?? '—',
          humidity: humidity ?? '—',
          current: current ?? '—',
          power: power ?? '—',
          battery: battery ?? '—',
          mood: mood ?? '—'
        };
      })
      .filter(row => row.tsMs !== null);
  } catch (err) {
    console.error('❌ Failed to read replay feed from Google Sheets:', err.message);
    return [];
  }
}

// Read Alpaca Trades sheet and normalize into structured objects
async function readTradesFromSheet(limit = 500, sheetName = 'Alpaca Trades') {
  if (!sheetsClient) {
    console.error('❌ Sheets client not initialized. Call authorizeGoogleSheets() first.');
    return [];
  }
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:L`,
      majorDimension: 'ROWS'
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return [];
    const recent = rows.slice(-limit).reverse(); // newest first

    return recent
      .map(r => {
        // Flexible parsing to support old rows without tsMs/iso
        let idx = 0;
        let tsMs = Number(r[idx]);
        if (!Number.isFinite(tsMs)) {
          tsMs = null;
        } else {
          idx++;
        }

        let tsIso = null;
        if (r[idx] && typeof r[idx] === 'string' && r[idx].includes('T')) {
          tsIso = r[idx];
          idx++;
        }

        const time = r[idx++] ?? null; // local time string (old format)
        const symbol = r[idx++] ?? null;
        const side = r[idx++] ?? null;
        const entryPrice = Number(r[idx++]);
        const exitPrice = Number(r[idx++]);
        const shares = Number(r[idx++]);
        const pnl = Number(r[idx++]);
        const pnlPercent = Number(r[idx++]);
        const reason = r[idx++] ?? null;
        const holdMinutes = Number(r[idx++]);

        // Fallback: derive tsMs from iso/local time if needed
        if (!tsMs) {
          if (tsIso && !isNaN(Date.parse(tsIso))) {
            tsMs = Date.parse(tsIso);
          } else if (time && !isNaN(Date.parse(time))) {
            tsMs = Date.parse(time);
          }
        }

        return {
          tsMs,
          tsIso,
          time,
          symbol,
          side,
          entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
          exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
          shares: Number.isFinite(shares) ? shares : null,
          pnl: Number.isFinite(pnl) ? pnl : null,
          pnlPercent: Number.isFinite(pnlPercent) ? pnlPercent : null,
          reason,
          holdMinutes: Number.isFinite(holdMinutes) ? holdMinutes : null
        };
      })
      .filter(t => t.symbol);
  } catch (err) {
    console.error('❌ Failed to read trades from Google Sheets:', err.message);
    return [];
  }
}

module.exports = {
  authorizeGoogleSheets,
  logToSheet,
  readRecentFromSheet,
  readReplayFeed,
  readTradesFromSheet,
};
