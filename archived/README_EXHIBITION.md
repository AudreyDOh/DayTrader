# 전시 시스템 요약

## 📁 프로젝트 구조

### 핵심 파일 (현재 디렉토리)
- `index.js` - 메인 서버 (트레이딩 + BLE Display 로깅)
- `sendBLEReplaySync.js` - LED 전광판 전송 (전시용)
- `tradeManager.js` - 트레이딩 로직
- `solarStrategy.js` - 전략 로직
- `tickerTape.js` - BLE 메시지 생성
- `logToSheets.js` - Google Sheets 연동
- `alpaca.js` - Alpaca API
- `localLog.js` - 로컬 로깅

### Archived 파일 (archived/ 폴더)
- 모든 디버그, 테스트, 체크 스크립트
- 다른 BLE 전송 스크립트들

---

## 🎯 전시 시나리오

### 1/5 (월)
- **9:30 AM ~ 5:30 PM**: 센서 데이터 수집 (완료)
- **저녁 11:30 PM**: 트레이딩 서버 시작

### 1/6 ~ 1/10 (화~토)
- **매일 9:30 AM ~ 5:30 PM**: LED 전광판 표시
- **매일 저녁 11:30 PM**: 다음날 트레이딩 서버 시작

---

## 🚀 실행 방법

### 터미널 1: 트레이딩 서버
```bash
cd "/Users/dahyung/Code Repo/Energy"
./start_replay_trading.sh
```

### 터미널 2: LED 전광판 (매일 9:30 AM)
```bash
cd "/Users/dahyung/Code Repo/Energy"
./START_EXHIBITION_BLE.sh
```

---

## 📊 데이터 흐름

1. **센서 데이터** → Google Sheets "Replay Feed"
2. **트레이딩 실행** → Google Sheets "Alpaca Trades"
3. **BLE Display 로깅** → Google Sheets "BLE Display" (1분마다)
4. **LED 전광판 표시** → `sendBLEReplaySync.js`가 "BLE Display"에서 읽어서 전송

---

## 💡 주요 기능

### 2개 메시지 시퀀스
각 시간대마다:
1. **기상 데이터 + 웨더 무드** (DECISION/MARKET_CLOSED)
2. **트레이딩 데이터** (POSITION/EXIT/ORDER) 또는 Last Trade 정보

### 시간 동기화
- 1/5 KST 9:30 AM 데이터 → 1/6 KST 9:30 AM에 표시
- 1분마다 업데이트
- 원본 시간에 맞춰 정확히 재생

---

자세한 내용은 `EXHIBITION_GUIDE.md` 참조


