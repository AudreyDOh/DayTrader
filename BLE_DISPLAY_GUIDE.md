# BLE Display 정보 정리 및 실시간 트레이딩 강조 가이드

## 📊 현재 BLE Display 정보 정리

### 1. **DECISION** 타입 (트레이딩 결정 전)
**Line 1:** `LUX 19k TEMP 24 HUM 27 PWR 0.612`
- 기상 센서 데이터 (Lux, Temperature, Humidity, Power)

**Line 2:** `MOOD DRY & CLOUDY BUY NKE, LULU`
- 기상 무드 + 추천 종목

---

### 2. **ORDER** 타입 (트레이딩 실행 순간) ⚡
**Line 1:** `LUX 19k TEMP 24 HUM 27 PWR 0.612`
- 기상 센서 데이터

**Line 2:** `⚡ SELL NKE @ 63.24 SL 2.8% TP 5.6% SIZE 945 HOLD 8m`
- ⚡ 표시 + 매수/매도 + 종목 + 진입가 + 손절/익절 + 수량 + 보유 시간

---

### 3. **POSITION** 타입 (포지션 보유 중) 📊
**Line 1:** `📊 OPEN POSITION: NKE SHORT @ 63.24 P/L -0.5% ▼ HOLD 5m`
- 📊 OPEN POSITION 표시 + 종목 + 방향 + 진입가 + 손익 + 방향 화살표 + 남은 보유 시간

**Line 2:** `SL 2.8% TP 5.6% SIZE 945`
- 손절/익절 + 수량

---

### 4. **EXIT** 타입 (포지션 청산)
**Line 1:** `NKE SHORT @ 63.24 EXIT 62.50 ▼`
- 종목 + 방향 + 진입가 + 청산가 + 방향 화살표

**Line 2:** `TIMEOUT -1.2% HELD 8m`
- 청산 이유 + 손익 + 보유 시간

---

## 🚀 실시간 트레이딩 강조를 위한 Line1/Line2 추천

### 추천 1: 시간 정보 추가 (가장 추천)
**ORDER 타입:**
```
Line 1: ⚡ LIVE TRADE 09:35 EST
Line 2: SELL NKE @ 63.24 HOLD 8m SL 2.8% TP 5.6%
```

**POSITION 타입:**
```
Line 1: 📊 OPEN: NKE SHORT @ 63.24 P/L -0.5% ▼
Line 2: HOLD 5m LEFT | SL 2.8% TP 5.6% SIZE 945
```

---

### 추천 2: 카운트다운 강조
**ORDER 타입:**
```
Line 1: ⚡ TRADE EXECUTED 09:35
Line 2: SELL NKE 945 @ 63.24 | HOLD 8:00
```

**POSITION 타입:**
```
Line 1: 📊 NKE SHORT @ 63.24 P/L -0.5% ▼
Line 2: ⏱️ HOLD 5:23 LEFT | SL 2.8% TP 5.6%
```

---

### 추천 3: 간결하고 임팩트 있는 메시지
**ORDER 타입:**
```
Line 1: ⚡ LIVE: SELL NKE @ 63.24
Line 2: SIZE 945 | HOLD 8m | SL 2.8% TP 5.6%
```

**POSITION 타입:**
```
Line 1: 📊 NKE SHORT 63.24 → P/L -0.5% ▼
Line 2: ⏱️ 5m LEFT | SL 2.8% TP 5.6% | 945
```

---

### 추천 4: 실시간 강조 (가장 강력)
**ORDER 타입:**
```
Line 1: ⚡⚡ LIVE TRADING ⚡⚡ 09:35
Line 2: SELL NKE @ 63.24 | HOLD 8:00 | SIZE 945
```

**POSITION 타입:**
```
Line 1: 📊 LIVE POSITION: NKE SHORT @ 63.24
Line 2: P/L -0.5% ▼ | ⏱️ 5:23 LEFT | SL 2.8% TP 5.6%
```

---

## 💡 최종 추천 (실시간 트레이딩 강조)

### ORDER 타입 (트레이딩 실행 순간)
```
Line 1: ⚡ LIVE TRADE 09:35 EST
Line 2: SELL NKE @ 63.24 | HOLD 8m | SL 2.8% TP 5.6%
```

**이유:**
- ⚡로 즉시성 강조
- 시간 정보로 실시간임을 명확히
- 핵심 정보만 간결하게

### POSITION 타입 (포지션 보유 중)
```
Line 1: 📊 LIVE: NKE SHORT @ 63.24 P/L -0.5% ▼
Line 2: ⏱️ HOLD 5:23 LEFT | SL 2.8% TP 5.6% | SIZE 945
```

**이유:**
- 📊로 포지션 상태 명확히
- LIVE로 실시간 강조
- ⏱️로 카운트다운 시각화
- 분:초 형식으로 정확한 시간 표시

---

## 🔧 구현 방법

`tickerTape.js`의 `formatOrder`와 `formatActivePosition` 함수를 수정하면 됩니다.

### 현재 코드 위치:
- `formatOrder`: `tickerTape.js` 112-127줄
- `formatActivePosition`: `tickerTape.js` 129-146줄

### 수정 예시:
```javascript
// ORDER 타입
function formatOrder(sensor, order, risk, account) {
  const now = new Date();
  const estTime = now.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit'
  });
  const line1 = `⚡ LIVE TRADE ${estTime} EST`;
  // ... 나머지
}

// POSITION 타입
function formatActivePosition(position) {
  const holdLeft = position?.holdMinutesLeft != null 
    ? Math.max(0, Math.round(position.holdMinutesLeft))
    : 0;
  const holdMin = Math.floor(holdLeft);
  const holdSec = Math.floor((holdLeft - holdMin) * 60);
  const line1 = `📊 LIVE: ${position?.symbol} ${sideToLabel(position?.side)} @ ${price} P/L ${plStr} ${arrow}`;
  const line2 = `⏱️ HOLD ${holdMin}:${String(holdSec).padStart(2,'0')} LEFT | SL ${sl} TP ${tp} | SIZE ${size}`;
  // ...
}
```

