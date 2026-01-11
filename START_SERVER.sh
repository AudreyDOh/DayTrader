#!/bin/bash
# 트레이딩 서버 시작 스크립트
# 사용법: ./START_SERVER.sh

cd "/Users/dahyung/Code Repo/Energy"

echo "🎬 트레이딩 서버 시작..."
echo "📅 현재 시간: $(date)"
echo "🌍 한국 시간: $(TZ=Asia/Seoul date)"
echo "🌍 미국 동부 시간: $(TZ=America/New_York date)"
echo ""

# 환경 변수 설정
export REPLAY_MODE=true
export REPLAY_TRADE=true

# 서버 시작
node index.js

