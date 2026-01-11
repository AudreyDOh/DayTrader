# BLE Content 정리 (EST 9:30am부터)

## 📊 생성된 BLE Content 시트 요약

**날짜:** 2026-01-08  
**시간 범위:** EST 9:30am - 4:00pm  
**총 엔트리:** 330개

### 메시지 타입별 통계
- **NO_DATA**: 239개 (데이터 없음)
- **POSITION**: 79개 (포지션 보유 중)
- **DECISION**: 12개 (트레이딩 결정 전)

---

## 📋 1분마다 블루투스 전송 내용

### EST 9:30am
**타입:** DECISION  
**Line 1:** `LUX 18k TEMP 21 HUM 10 PWR 0.056`  
**Line 2:** `MOOD UNKNOWN WATCH —`  
**설명:** 트레이딩 결정 전 (아직 안 샀을 때)

---

### EST 9:34am
**타입:** DECISION  
**Line 1:** `LUX 20k TEMP 23 HUM 9 PWR 0.058`  
**Line 2:** `MOOD DRY CLOUDY WATCH NKE LULU`  
**설명:** 기상 무드 결정, 추천 종목 표시

---

### EST 9:35am (ORDER 실행 시점 예시)
**타입:** ORDER_WEATHER (1차)  
**Line 1:** `LUX 20k TEMP 24 HUM 9 PWR 0.612`  
**Line 2:** `MOOD DRY CLOUDY LIVE TRADING`  
**설명:** ORDER 실행 시점의 기상 데이터

**타입:** ORDER (2차, 5초 후)  
**Line 1:** `LIVE TRADE 09:35 EST`  
**Line 2:** `SELL NKE 63.24 HOLD 8m SL 2.8 TP 5.6 SIZE 945`  
**설명:** ORDER 정보 (BUY/SELL 실행)

---

### EST 9:36am 이후 (포지션 보유 중)
**타입:** POSITION  
**Line 1:** `OPEN NKE SELL 63.24 P/L -0.5% HOLD 5m`  
**Line 2:** `SL 2.8 TP 5.6 SIZE 945`  
**설명:** 포지션 보유 중, 실시간 P/L 및 남은 HOLD 시간 표시

---

## 🔄 전송 시퀀스 예시

### ORDER 실행 시 (EST 9:35am)
```
[09:35:00] 1차 전송 (ORDER_WEATHER)
  Line 1: LUX 20k TEMP 24 HUM 9 PWR 0.612
  Line 2: MOOD DRY CLOUDY LIVE TRADING
  ↓ (5초 대기)
[09:35:05] 2차 전송 (ORDER)
  Line 1: LIVE TRADE 09:35 EST
  Line 2: SELL NKE 63.24 HOLD 8m SL 2.8 TP 5.6 SIZE 945
```

### 포지션 보유 중 (EST 9:36am - 9:44am)
```
[09:36:00] 전송 (POSITION)
  Line 1: OPEN NKE SELL 63.24 P/L -0.5% HOLD 5m
  Line 2: SL 2.8 TP 5.6 SIZE 945

[09:37:00] 전송 (POSITION)
  Line 1: OPEN NKE SELL 63.24 P/L -0.3% HOLD 4m
  Line 2: SL 2.8 TP 5.6 SIZE 945
  ...
```

### 포지션 청산 시 (EST 9:44am)
```
[09:44:00] 전송 (EXIT)
  Line 1: EXIT NKE SELL 63.24 62.50 TIMEOUT
  Line 2: P/L -1.2% HELD 8m
```

---

## 💡 메시지 타입별 포맷

### DECISION (아무것도 안 샀을 때)
```
Line 1: LUX [값] TEMP [값] HUM [값] PWR [값]
Line 2: MOOD [무드] WATCH [종목1] [종목2]
```

### ORDER_WEATHER (1차 - ORDER 실행 시점 기상 데이터)
```
Line 1: LUX [값] TEMP [값] HUM [값] PWR [값]
Line 2: MOOD [무드] LIVE TRADING
```

### ORDER (2차 - ORDER 정보, 5초 후)
```
Line 1: LIVE TRADE [시간] EST
Line 2: BUY/SELL [종목] [가격] HOLD [시간]m SL [%] TP [%] SIZE [수량]
```

### POSITION (사 놓고 HOLD 할 때)
```
Line 1: OPEN [종목] BUY/SELL [가격] P/L [손익]% HOLD [남은시간]m
Line 2: SL [%] TP [%] SIZE [수량]
```

### EXIT (포지션 청산)
```
Line 1: EXIT [종목] BUY/SELL [진입가] [청산가] [이유]
Line 2: P/L [손익]% HELD [보유시간]m
```

---

## 📌 주요 포인트

1. **1분마다 전송**: 각 EST 시간(분)마다 해당하는 메시지 전송
2. **ORDER는 2단계**: 1차(기상) → 5초 대기 → 2차(ORDER 정보)
3. **POSITION은 실시간 업데이트**: P/L과 HOLD 시간이 실시간으로 업데이트됨
4. **BUY/SELL 명확히**: LONG/SHORT 대신 BUY/SELL로 표시
5. **이모티콘/기호 제거**: 깔끔한 텍스트만 사용

