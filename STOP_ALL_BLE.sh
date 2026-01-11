#!/bin/bash
# 모든 블루투스 전송 프로세스 중지

cd "/Users/dahyung/Code Repo/Energy"

echo "🛑 모든 블루투스 전송 프로세스 중지 중..."

# 모든 BLE 관련 스크립트 중지
pkill -f "sendBLEReplaySync.js" 2>/dev/null
pkill -f "sendBLERealtime.js" 2>/dev/null
pkill -f "sendBLEWithTrades.js" 2>/dev/null
pkill -f "sendBLEToday.js" 2>/dev/null
pkill -f "sendBLESample.js" 2>/dev/null
pkill -f "sendBLEScheduled.js" 2>/dev/null

sleep 1

# 확인
REMAINING=$(ps aux | grep -E "sendBLE" | grep -v grep | wc -l | tr -d ' ')
if [ "$REMAINING" -eq 0 ]; then
  echo "✅ 모든 블루투스 전송 프로세스 중지 완료"
else
  echo "⚠️ 일부 프로세스가 아직 실행 중입니다:"
  ps aux | grep -E "sendBLE" | grep -v grep
  echo ""
  echo "강제 종료하려면:"
  echo "  killall -9 node"
fi


