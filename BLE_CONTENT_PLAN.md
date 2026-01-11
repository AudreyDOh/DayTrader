# BLE Content 1분당 4줄 구조 계획

## 📋 목표 구조

**매 1분마다 총 4줄 표시:**
- **1단계 (기상 데이터 모드)**: Line 1, Line 2
- **2단계 (ORDER 모드)**: Line 1, Line 2

---

## 🔄 전송 시퀀스

### 예시: EST 9:35am

```
[09:35:00] 1단계 시작 - 기상 데이터 모드
  Line 1: LUX 20k TEMP 24 HUM 9 PWR 0.612
  Line 2: MOOD DRY CLOUDY WATCH NKE LULU
  ↓ (약 30초 또는 5초 간격)
[09:35:30] 2단계 시작 - ORDER 모드
  Line 1: LIVE TRADE 09:44 EST
  Line 2: SELL NKE 63.24 LIVE TRADING
  ↓
[09:36:00] 다음 1분 주기 시작...
```

---

## 📊 BLE Content 시트 구조

각 시간(분)마다 **2행** 생성:

| EST_TIME | STAGE | MESSAGE_TYPE | LINE1 | LINE2 | DESCRIPTION |
|----------|-------|--------------|-------|-------|-------------|
| 9:35 | 1 | WEATHER | LUX 20k TEMP 24... | MOOD DRY CLOUDY WATCH NKE LULU | 1단계: 기상 데이터 |
| 9:35 | 2 | ORDER | LIVE TRADE 09:44 EST | SELL NKE 63.24 LIVE TRADING | 2단계: ORDER 정보 |
| 9:36 | 1 | WEATHER | LUX 21k TEMP 24... | MOOD DRY CLOUDY WATCH NKE LULU | 1단계: 기상 데이터 |
| 9:36 | 2 | LAST_ORDER | LAST ORDER 09:44 EST | SELL NKE 63.24 LIVE TRADING | 2단계: 마지막 ORDER |
| 9:37 | 1 | WEATHER | LUX 22k TEMP 25... | MOOD DRY CLOUDY WATCH NKE LULU | 1단계: 기상 데이터 |
| 9:37 | 2 | POSITION | OPEN NKE SELL 63.24... | SL 2.8 TP 5.6 SIZE 945 | 2단계: 포지션 정보 (ORDER 대신) |

---

## 💡 로직 규칙

### 1단계: 기상 데이터 (항상 표시)
- **우선순위**: 해당 시간의 기상 데이터
- **포맷**:
  - Line 1: `LUX [값] TEMP [값] HUM [값] PWR [값]`
  - Line 2: `MOOD [무드] WATCH [종목1] [종목2]`
- **데이터 소스**: BLE Display의 DECISION 또는 해당 시간의 센서 데이터

### 2단계: ORDER 모드 (우선순위)
1. **ORDER** (해당 시간에 ORDER 실행된 경우)
   - Line 1: `LIVE TRADE [시간] EST`
   - Line 2: `BUY/SELL [종목] [가격] LIVE TRADING`

2. **LAST_ORDER** (ORDER가 없고 이전 ORDER가 있는 경우)
   - Line 1: `LAST ORDER [시간] EST`
   - Line 2: `BUY/SELL [종목] [가격] LIVE TRADING`

3. **POSITION** (ORDER가 없고 포지션이 있는 경우)
   - Line 1: `OPEN [종목] BUY/SELL [가격] P/L [손익]% HOLD [시간]m`
   - Line 2: `SL [%] TP [%] SIZE [수량]`

4. **DECISION** (ORDER도 포지션도 없는 경우)
   - Line 1: `LUX [값] TEMP [값] HUM [값] PWR [값]`
   - Line 2: `MOOD [무드] WATCH [종목]`

---

## 🔧 구현 변경 사항

### generateBLEContent.js 수정
1. 각 시간(분)마다 2행 생성
2. 1단계: 기상 데이터 행 추가
3. 2단계: ORDER/LAST_ORDER/POSITION 행 추가
4. STAGE 컬럼 추가 (1 또는 2)

### 전송 로직
- 1분 시작 → 1단계 전송 (기상 데이터)
- 약 30초 후 → 2단계 전송 (ORDER 정보)
- 또는 5초 간격으로 전송

---

## 📈 예상 결과

**총 행 수**: 330분 × 2 = **660행**
- 1단계 (WEATHER): 330행
- 2단계 (ORDER/LAST_ORDER/POSITION): 330행

**메시지 타입 분포**:
- WEATHER: 330개 (1단계)
- ORDER: ~10개 (2단계)
- LAST_ORDER: ~300개 (2단계)
- POSITION: ~20개 (2단계, ORDER가 없을 때)

---

## ✅ 장점

1. **일관성**: 매 시간마다 동일한 구조 (기상 → ORDER)
2. **가독성**: 1분당 4줄로 정보가 명확하게 구분
3. **실시간성**: 기상 데이터와 ORDER 정보를 모두 표시
4. **자동 진행 표시**: LAST_ORDER로 시스템이 계속 작동 중임을 보여줌

