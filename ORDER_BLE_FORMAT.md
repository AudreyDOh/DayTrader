# ORDER 타입 BLE Display 포맷 정리

## 📋 ORDER 타입 메시지 구조

ORDER 타입은 **2개의 메시지**로 구성됩니다:

### 1차: 기상 데이터 (ORDER_WEATHER)
**Line 1:** `LUX 19k TEMP 24 HUM 27 PWR 0.612`
- ORDER가 실행된 순간의 실시간 기상 센서 데이터

**Line 2:** `MOOD DRY & CLOUDY | LIVE TRADING`
- 기상 무드 + LIVE TRADING 표시

---

### 2차: ORDER 정보 (ORDER)
**Line 1:** `⚡ LIVE TRADE 09:35 EST`
- ⚡ 표시 + LIVE TRADE + 실행 시간 (EST)

**Line 2:** `SELL NKE @ 63.24 | HOLD 8m | SL 2.8% TP 5.6% SIZE 945`
- 매수/매도 + 종목 + 진입가 + 보유 시간 + 손절/익절 + 수량

---

## 🔄 전송 방식

### BLE Display 시트에 로깅
- ORDER 실행 시 **1차(ORDER_WEATHER)**와 **2차(ORDER)** 두 개의 로그가 기록됨
- `message_type`으로 구분:
  - `ORDER_WEATHER`: 1차 기상 데이터
  - `ORDER`: 2차 ORDER 정보

### 블루투스 전송 (1분마다, 5초 간격)
1. **1차 메시지 전송** (ORDER_WEATHER)
   - Line 1: `LUX 19k TEMP 24 HUM 27 PWR 0.612`
   - Line 2: `MOOD DRY & CLOUDY | LIVE TRADING`
   - 전송 후 **5초 대기**

2. **2차 메시지 전송** (ORDER)
   - Line 1: `⚡ LIVE TRADE 09:35 EST`
   - Line 2: `SELL NKE @ 63.24 | HOLD 8m | SL 2.8% TP 5.6% SIZE 945`
   - 전송 완료

---

## 📊 예시 시퀀스

```
[09:35:00] ORDER 실행
  ↓
[09:35:00] BLE Display 로깅:
  - ORDER_WEATHER (1차): 기상 데이터
  - ORDER (2차): ORDER 정보
  ↓
[09:36:00] BLE 전송 시작 (1분 후)
  ↓
[09:36:00] 1차 전송: 기상 데이터
  Line 1: LUX 19k TEMP 24 HUM 27 PWR 0.612
  Line 2: MOOD DRY & CLOUDY | LIVE TRADING
  ↓
[09:36:05] 2차 전송: ORDER 정보 (5초 후)
  Line 1: ⚡ LIVE TRADE 09:35 EST
  Line 2: SELL NKE @ 63.24 | HOLD 8m | SL 2.8% TP 5.6% SIZE 945
  ↓
[09:37:00] 다음 1분 주기 시작...
```

---

## 💡 구현 포인트

1. **tickerTape.js**: `formatOrder` 함수가 두 개의 메시지를 반환
2. **index.js**: ORDER 타입일 때 두 개의 로그를 BLE Display 시트에 기록
3. **BLE 전송**: `sendBLEReplaySync.js`에서 `ORDER_WEATHER`와 `ORDER` 타입을 5초 간격으로 전송

