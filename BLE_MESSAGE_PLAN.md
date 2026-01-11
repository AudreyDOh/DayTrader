# BLE Display 메시지 포맷 계획

## 📋 상태별 메시지 구조

### 1. DECISION (아무것도 안 샀을 때)
**상태:** 포지션 없음, 트레이딩 결정 전

**Line 1:** `LUX 19k TEMP 24 HUM 27 PWR 0.612`
- 실시간 기상 센서 데이터

**Line 2:** `MOOD DRY CLOUDY WATCH NKE LULU`
- 기상 무드 + WATCH (관찰 중) + 추천 종목

---

### 2. ORDER (트레이딩 실행 순간)

#### 1차: 기상 데이터
**Line 1:** `LUX 19k TEMP 24 HUM 27 PWR 0.612`
- ORDER 실행 시점의 기상 데이터

**Line 2:** `MOOD DRY CLOUDY LIVE TRADING`
- 기상 무드 + LIVE TRADING 표시

#### 2차: ORDER 정보
**Line 1:** `LIVE TRADE 09:35 EST`
- LIVE TRADE + 실행 시간 (EST)

**Line 2:** `BUY NKE 63.24 HOLD 8m SL 2.8 TP 5.6 SIZE 945`
- BUY/SELL + 종목 + 진입가 + 보유 시간 + 손절 + 익절 + 수량

---

### 3. POSITION (사 놓고 HOLD 할 때)
**상태:** 포지션 보유 중

**Line 1:** `OPEN NKE SHORT 63.24 P/L -0.5 HOLD 5m`
- OPEN + 종목 + LONG/SHORT + 진입가 + 손익 + 남은 보유 시간

**Line 2:** `SL 2.8 TP 5.6 SIZE 945`
- 손절 + 익절 + 수량

---

### 4. EXIT (포지션 청산)
**상태:** 포지션 청산 완료

**Line 1:** `EXIT NKE SHORT 63.24 62.50 TIMEOUT`
- EXIT + 종목 + LONG/SHORT + 진입가 + 청산가 + 청산 이유

**Line 2:** `P/L -1.2 HELD 8m`
- 손익 + 보유 시간

---

## 🔄 BUY vs SELL 결정 로직

### BUY (LONG 진입)
- **조건:** 최근 5개 바에서 가격이 0.5% 이상 상승 (trendUp)
- **표시:** `BUY 종목 @ 가격`
- **의미:** 상승 추세 → 매수 후 상승 기대

### SELL (SHORT 진입)
- **조건:** 최근 5개 바에서 가격이 0.5% 이상 하락 (trendDown)
- **표시:** `SELL 종목 @ 가격`
- **의미:** 하락 추세 → 매도 후 하락 기대

### 트렌드 없을 때
- 랜덤으로 LONG 또는 SHORT 진입
- BUY 또는 SELL로 표시

---

## 📊 메시지 타입별 요약

| 상태 | Line 1 | Line 2 | 설명 |
|------|--------|--------|------|
| **DECISION** | 기상 데이터 | MOOD + WATCH + 종목 | 아직 안 샀을 때 |
| **ORDER_WEATHER** (1차) | 기상 데이터 | MOOD + LIVE TRADING | ORDER 실행 시 기상 |
| **ORDER** (2차) | LIVE TRADE 시간 | BUY/SELL + 종목 + 가격 + HOLD + SL + TP + SIZE | ORDER 실행 정보 |
| **POSITION** | OPEN + 종목 + 방향 + 가격 + P/L + HOLD | SL + TP + SIZE | 포지션 보유 중 |
| **EXIT** | EXIT + 종목 + 방향 + 진입가 + 청산가 + 이유 | P/L + HELD 시간 | 포지션 청산 |

---

## 💡 표현 규칙

1. **이모티콘 제거:** ⚡, 📊, ▲, ▼ 등 모두 제거
2. **기호 제거:** | (파이프) 제거, 공백으로 구분
3. **BUY/SELL 명확히:**
   - BUY = LONG 진입 (상승 추세)
   - SELL = SHORT 진입 (하락 추세)
4. **시간 표시:**
   - HOLD 8m (보유 시간)
   - HOLD 5m (남은 시간)
   - HELD 8m (보유했던 시간)
5. **간결성:** 핵심 정보만, 불필요한 단어 제거

