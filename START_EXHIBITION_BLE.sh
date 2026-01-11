#!/bin/bash
# 전시용 BLE 전송 스크립트
# 매일 9:30 AM ~ 5:30 PM 실행

cd "/Users/dahyung/Code Repo/Energy"
echo "🚀 Starting BLE Display for Exhibition..."
echo "📅 Date: $(date '+%Y-%m-%d %H:%M:%S KST')"
echo ""

node sendBLEReplaySync.js


