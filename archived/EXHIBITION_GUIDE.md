# 전시 실행 가이드 (1/6 ~ 1/10)

## 📅 전시 일정
- **기간**: 2026년 1월 6일 (화) ~ 1월 10일 (토)
- **시간**: 매일 한국시간 9:30 AM ~ 5:30 PM
- **센서 데이터**: 1월 5일부터 24시간 수집 완료 (1분마다)

---

## 🔄 시스템 동작 방식

### 1단계: 데이터 수집 (1/5 완료)
- 한국 시간 1/5 9:30 AM ~ 5:30 PM 기상 데이터 수집 완료
- Google Sheets "Replay Feed"에 저장됨

### 2단계: 트레이딩 실행 (1/5 저녁 ~ 1/6 새벽)
- 한국 시간 1/5 저녁 11:30 PM부터 시작 (미국 시장 개장)
- 1/5 한국 9:30 AM 데이터 → 미국 9:30 AM으로 1:1 대응하여 트레이딩
- 트레이딩 결과는 "Alpaca Trades" 시트에 저장
- BLE Display 데이터는 "BLE Display" 시트에 1분마다 자동 로깅

### 3단계: LED 전광판 표시 (1/6 ~ 1/10 매일 9:30 AM ~ 5:30 PM)
- 어제(1/5) 한국 기상 데이터와 트레이딩 데이터를 LED 전광판에 표시
- 1분마다 업데이트
- 각 시간대마다 2개 메시지 시퀀스:
  1. **기상 데이터 + 웨더 무드** (Line 1, Line 2)
  2. **트레이딩 데이터** (주식 정보, Hold time 등) 또는 Last Trade 정보

---

## 🚀 실행 방법

### 터미널 1: 트레이딩 서버 (1/5 저녁 11:30 PM 시작)

```bash
cd "/Users/dahyung/Code Repo/Energy"
REPLAY_MODE=true REPLAY_TRADE=true node index.js
```

**또는 스크립트 사용:**
```bash
cd "/Users/dahyung/Code Repo/Energy"
./start_replay_trading.sh
```

**확인 사항:**
- 서버 로그에서 `🔄 Processing KST` 메시지 확인
- Google Sheets "Alpaca Trades" 탭에서 트레이딩 기록 확인
- 다음날 아침까지 서버 유지 (한국 시간 새벽 6시까지)

---

### 터미널 2: LED 전광판 전송 (1/6 ~ 1/10 매일 9:30 AM 시작)

**매일 아침 9:30 AM에 실행:**

```bash
cd "/Users/dahyung/Code Repo/Energy"
node sendBLEReplaySync.js
```

**동작 방식:**
- 1/5 한국 시간 데이터를 읽어서
- 오늘 같은 시간에 LED 전광판에 표시
- 예: 1/5 KST 1:00 PM 데이터 → 1/6 KST 1:00 PM에 표시
- 1분마다 업데이트
- 각 시간대마다 2개 메시지 시퀀스 전송

**중지 방법:**
- `Ctrl + C`로 중지
- 또는 5:30 PM까지 자동 실행 후 종료

---

## 📊 데이터 확인

### Google Sheets 확인
1. **"DayTrader Replay Log" → "Replay Feed"**: 센서 데이터 (1/5)
2. **"DayTrader Replay Log" → "Alpaca Trades"**: 트레이딩 기록
3. **"DayTrader Replay Log" → "BLE Display"**: LED 전광판 표시 데이터

### 로그 확인
```bash
# 트레이딩 서버 로그
tail -f server_replay.log

# BLE 전송 로그는 터미널에 직접 출력됨
```

---

## ⚙️ 환경 변수 확인

필요한 환경 변수:
- `GOOGLE_CREDENTIALS`: Google Sheets 인증 정보
- `GOOGLE_SPREADSHEET_ID`: Google Sheets ID
- `ALPACA_API_KEY`: Alpaca API 키
- `ALPACA_SECRET_KEY`: Alpaca 시크릿 키
- `BLE_MAC`: BLE 디바이스 MAC 주소 (선택사항)

확인 방법:
```bash
echo $GOOGLE_CREDENTIALS | head -c 50
echo $GOOGLE_SPREADSHEET_ID
echo $ALPACA_API_KEY | head -c 20
```

---

## 🎯 일일 체크리스트

### 1/6 (화) ~ 1/10 (토) 매일:

**오전 9:30 AM:**
- [ ] 터미널 2에서 `node sendBLEReplaySync.js` 실행
- [ ] LED 전광판에 메시지가 표시되는지 확인
- [ ] 2개 메시지 시퀀스(기상 + 트레이딩)가 정상적으로 표시되는지 확인

**오후 5:30 PM:**
- [ ] LED 전송 스크립트 종료 (또는 자동 종료 대기)

**저녁 11:30 PM (1/5 ~ 1/9):**
- [ ] 터미널 1에서 트레이딩 서버 실행 (다음날 트레이딩용)
- [ ] 서버 로그 확인
- [ ] 다음날 아침까지 서버 유지

---

## 🔧 문제 해결

### LED 전광판에 메시지가 표시되지 않는 경우
1. BLE 디바이스 연결 확인
2. `BLE_MAC` 환경 변수 확인
3. Python 스크립트 경로 확인: `vendor/iPixel-CLI/two_line_png.py`
4. 터미널 로그에서 에러 메시지 확인

### 트레이딩이 실행되지 않는 경우
1. 미국 시장 시간 확인 (EST 9:30 AM - 4:00 PM)
2. `REPLAY_MODE=true REPLAY_TRADE=true` 확인
3. Google Sheets "Replay Feed"에 데이터가 있는지 확인
4. 서버 로그에서 `🔄 Processing KST` 메시지 확인

### 데이터가 없는 경우
1. Google Sheets "BLE Display" 시트 확인
2. "Replay Feed" 시트에 1/5 데이터가 있는지 확인
3. "Alpaca Trades" 시트에 트레이딩 기록이 있는지 확인

---

## 📝 메시지 형식

### 기상 데이터 메시지 (Line 1, Line 2)
```
LUX 25k TEMP 28 HUM 45 PWR 0.350
MOOD BRIGHT & DRY BUY MSFT, GOOG
```

### 트레이딩 메시지 (Line 1, Line 2)
**포지션 있는 경우:**
```
MSFT LONG @ 175.50 P/L +2.5% ▲
SL 2.0% TP 4.0% SIZE 10 HOLD 30m
```

**트레이딩 없는 경우 (Last Trade):**
```
LAST TRADE: MSFT LONG
P/L +2.5% TP
```

---

## 🎨 전시 시나리오

1. **9:30 AM**: 전시 시작, LED 전광판 켜기
2. **9:30 AM ~ 5:30 PM**: 
   - 1분마다 기상 데이터 + 트레이딩 데이터 표시
   - 관객들이 실시간(처럼 보이는) 트레이딩 과정 관찰
3. **5:30 PM**: 전시 종료, LED 전광판 끄기

---

**준비 완료! 전시가 성공적으로 진행될 것입니다.** 🚀


