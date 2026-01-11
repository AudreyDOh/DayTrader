#!/bin/bash
# Replay 모드로 트레이딩 시작 스크립트
# 사용법: ./start_replay_trading.sh [날짜] [시작시간]
# 예시: ./start_replay_trading.sh 2026-01-08 09:30

cd "/Users/dahyung/Code Repo/Energy"

# 날짜와 시작 시간을 인자로 받거나 기본값 사용
TARGET_DATE=${1:-"2026-01-08"}
START_TIME=${2:-"09:30"}

echo "🎬 Replay 모드로 트레이딩 시작..."
echo "📅 현재 시간: $(date)"
echo "🌍 한국 시간: $(TZ=Asia/Seoul date)"
echo "🌍 미국 동부 시간: $(TZ=America/New_York date)"
echo ""
echo "🎯 타겟 날짜: ${TARGET_DATE}"
echo "⏰ 시작 시간: ${START_TIME} EST"
echo ""

# 환경 변수 설정
export REPLAY_MODE=true
export REPLAY_TRADE=true
export REPLAY_TARGET_DATE=${TARGET_DATE}
export REPLAY_START_TIME=${START_TIME}

# 서버 시작
node index.js

