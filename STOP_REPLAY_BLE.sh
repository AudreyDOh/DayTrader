#!/bin/bash
# Replay Mode 트레이딩 + 블루투스 전송 중지 스크립트

cd "/Users/dahyung/Code Repo/Energy"

echo "🛑 Replay Mode 트레이딩 + 블루투스 전송 중지 중..."

# PID 파일에서 읽기
if [ -f server_replay.pid ]; then
  REPLAY_PID=$(cat server_replay.pid)
  if ps -p $REPLAY_PID > /dev/null 2>&1; then
    kill $REPLAY_PID
    echo "✅ 트레이딩 서버 중지됨 (PID: $REPLAY_PID)"
  else
    echo "⚠️ 트레이딩 서버가 실행 중이 아닙니다"
  fi
  rm server_replay.pid
else
  echo "⚠️ server_replay.pid 파일이 없습니다"
fi

if [ -f ble_replay.pid ]; then
  BLE_PID=$(cat ble_replay.pid)
  if ps -p $BLE_PID > /dev/null 2>&1; then
    kill $BLE_PID
    echo "✅ 블루투스 전송 중지됨 (PID: $BLE_PID)"
  else
    echo "⚠️ 블루투스 전송이 실행 중이 아닙니다"
  fi
  rm ble_replay.pid
else
  echo "⚠️ ble_replay.pid 파일이 없습니다"
fi

# 추가로 프로세스 확인 및 종료
pkill -f "sendBLEReplaySync.js" 2>/dev/null
pkill -f "REPLAY_MODE=true.*index.js" 2>/dev/null

echo ""
echo "✅ 모든 프로세스 중지 완료!"


