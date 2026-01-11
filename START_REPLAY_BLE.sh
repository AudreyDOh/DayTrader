#!/bin/bash
# Replay Mode 트레이딩 + 블루투스 전송 시작 스크립트

cd "/Users/dahyung/Code Repo/Energy"

echo "🚀 Replay Mode 트레이딩 + 블루투스 전송 시작"
echo "📅 현재 시간: $(date)"
echo "🌍 한국 시간: $(TZ=Asia/Seoul date)"
echo "🌍 미국 동부 시간: $(TZ=America/New_York date)"
echo ""

# 1. Replay Mode 트레이딩 서버 시작 (백그라운드)
echo "1️⃣ Replay Mode 트레이딩 서버 시작 중..."
REPLAY_MODE=true REPLAY_TRADE=true node index.js > server_replay.log 2>&1 &
REPLAY_PID=$!
echo "   ✅ 서버 시작됨 (PID: $REPLAY_PID)"
echo "   📝 로그: server_replay.log"
echo ""

# 2. 블루투스 전송 스크립트 시작 (백그라운드)
echo "2️⃣ 블루투스 전송 스크립트 시작 중..."
node sendBLEReplaySync.js > ble_replay.log 2>&1 &
BLE_PID=$!
echo "   ✅ 블루투스 전송 시작됨 (PID: $BLE_PID)"
echo "   📝 로그: ble_replay.log"
echo ""

# PID 저장
echo $REPLAY_PID > server_replay.pid
echo $BLE_PID > ble_replay.pid

echo "✅ 모든 프로세스 시작 완료!"
echo ""
echo "📊 프로세스 확인:"
echo "   ps aux | grep -E 'index.js|sendBLEReplaySync' | grep -v grep"
echo ""
echo "📝 로그 확인:"
echo "   tail -f server_replay.log    # 트레이딩 서버 로그"
echo "   tail -f ble_replay.log       # 블루투스 전송 로그"
echo ""
echo "🛑 중지 방법:"
echo "   ./STOP_REPLAY_BLE.sh"
echo "   또는:"
echo "   kill \$(cat server_replay.pid) \$(cat ble_replay.pid)"


