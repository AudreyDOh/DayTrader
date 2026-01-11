# 오늘 밤 트레이딩 가이드

## ✅ 현재 상태 확인

**데이터 상태:**
- ✅ 오늘(2026-01-05 EST 기준) 데이터: **924개** entries
- ✅ Power positive entries: **492개** (5개 이상 필요, 충분함)
- ✅ 환경 변수: 모두 설정됨

**시장 시간:**
- EST: 9:30 AM - 4:00 PM (월-금)
- KST: 11:30 PM - 6:00 AM (다음날, 월-금)

---

## 🚀 트레이딩 시작 방법

### 1. 서버 시작 (한국 시간 밤 10시 30분 이후)

```bash
cd "/Users/dahyung/Code Repo/Energy"
./start_replay_trading.sh
```

또는 직접 실행:

```bash
REPLAY_MODE=true REPLAY_TRADE=true node index.js
```

### 2. 트레이딩 로직

**동작 방식:**
1. Replay Feed에서 오늘 날짜 데이터를 읽음
2. 한국 시간 → 미국 시간으로 치환 (같은 날짜, 같은 시간)
   - 예: 한국 1/5 1:00 PM → 미국 1/5 1:00 PM
3. 미국 시장이 열려있고, 시간이 매칭되면 트레이딩 실행
4. 트레이딩 결과는 **"Alpaca Trades"** 시트에 자동 기록

**트레이딩 시작 조건:**
- ✅ Power > 0 연속 5개 이상
- ✅ 미국 시장 오픈 (EST 9:30 AM - 4:00 PM)
- ✅ 한국 데이터 시간 = 현재 EST 시간

---

## 📊 트레이딩 확인 방법

### 1. 서버 로그 확인

다음 로그가 나타나면 트레이딩이 진행 중입니다:

```
🔄 Processing KST 2026-1-5 13:00 → EST 2026-1-5 13:00
   Sensor: Lux=25000, Temp=28, Humidity=45, Power=350
   Current powerPositiveCount: 5, marketOpen: true
```

### 2. Google Sheets 확인

**"DayTrader Replay Log" → "Alpaca Trades" 탭**에서 다음 정보 확인:
- 주문 시간
- 종목 (Symbol)
- 매수/매도 (Side)
- 수량 (Qty)
- 가격 (Price)
- 손익 (P/L)

### 3. 실시간 모니터링

```bash
# 트레이딩 상태 확인
node checkReplayData.js

# 또는 서버 로그 모니터링
tail -f server_replay.log
```

---

## ⏰ 예상 트레이딩 시간

**오늘 (2026-01-05):**
- 한국 시간 밤 11:30 PM → EST 9:30 AM (시장 오픈)
- 한국 시간 다음날 새벽 6:00 AM → EST 4:00 PM (시장 마감)

**데이터 범위:**
- 시작: 한국 시간 오전 12:00:33
- 종료: 한국 시간 오후 6:04:27

→ **한국 시간 밤 11:30 PM부터 트레이딩 시작 예상**

---

## 🔍 문제 해결

### 트레이딩이 시작되지 않는 경우

1. **Power 조건 확인:**
   ```bash
   node checkReplayData.js
   ```
   - Power positive entries가 5개 이상인지 확인

2. **시장 시간 확인:**
   - EST 9:30 AM - 4:00 PM (월-금)인지 확인
   - 주말이면 트레이딩 안 됨

3. **환경 변수 확인:**
   ```bash
   echo $REPLAY_MODE
   echo $REPLAY_TRADE
   ```
   - 둘 다 `true`여야 함

4. **서버 로그 확인:**
   - `🔄 Processing KST` 로그가 나타나는지 확인
   - `⏳ Waiting for time match` 로그가 계속 나타나면 시간 매칭 대기 중

---

## 📝 트레이딩 기록 위치

**모든 트레이딩 기록은 다음 위치에 저장됩니다:**

1. **Google Sheets:**
   - 시트: "DayTrader Replay Log"
   - 탭: "Alpaca Trades"
   - 컬럼: timestamp, symbol, side, qty, price, status, pnl 등

2. **로컬 로그:**
   - `localLog.js`를 통해 JSONL 파일로도 기록됨

---

## 🎯 오늘 밤 체크리스트

- [ ] 한국 시간 밤 10시 30분 이후 서버 시작
- [ ] `REPLAY_MODE=true REPLAY_TRADE=true` 확인
- [ ] 서버 로그에서 `🔄 Processing KST` 메시지 확인
- [ ] Google Sheets "Alpaca Trades" 탭에서 트레이딩 기록 확인
- [ ] 다음날 아침까지 서버 유지 (한국 시간 새벽 6시까지)

---

**준비 완료! 오늘 밤 트레이딩이 정상적으로 시작될 것입니다.** 🚀


