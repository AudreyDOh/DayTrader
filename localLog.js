const fs = require('fs');
const path = require('path');

const LOG_JSONL = process.env.LOG_JSONL === 'true';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');

function ensureDir() {
  if (!LOG_JSONL) return;
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function appendJsonl(basename, payload) {
  if (!LOG_JSONL) return;
  ensureDir();
  const file = path.join(LOG_DIR, basename);
  const line = `${JSON.stringify(payload)}\n`;
  fs.appendFile(file, line, err => {
    if (err) {
      console.error('❌ Failed to write JSONL log:', err.message);
    }
  });
}

module.exports = {
  appendJsonl
};

