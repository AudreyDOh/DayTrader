# 전체 시스템 실행 가이드

## 📋 전체 프로세스 요약

### 1단계: 트레이딩 (어제 저녁 ~ 오늘 새벽)
- 어제 한국 기상 데이터로 미국 시장에서 트레이딩
- 트레이딩 결과와 기상 데이터를 BLE Display 시트에 자동 로깅

### 2단계: LED 전광판 표시 (오늘 9:30 AM ~ 5:30 PM)
- 어제 트레이딩 결과와 기상 데이터를 LED 전광판에 표시
- 1분마다 업데이트

---

## 🚀 실행 방법

### 터미널 1: 트레이딩 서버

**시작 시점:** 어제 저녁 (미국 시장 개장 전, 한국 시간 밤 11:30 PM 전)

```bash
cd "/Users/dahyung/Code Repo/Energy"
./START_SERVER.sh
```

**또는:**
```bash
./start_replay_trading.sh
```

**확인 사항:**
- 로그에서 `📅 트레이딩 로직: 오늘 한국 X-X-X` 메시지 확인
- `📊 Loaded X sensor readings` 메시지로 데이터 로드 확인
- `🔄 한국 기상 데이터로 미국 시장 트레이딩` 메시지로 트레이딩 시작 확인

**종료:** 다음날 아침 (한국 시간 새벽 6시, 미국 시장 마감 후)

---

### 터미널 2: LED 전광판 전송

**시작 시점:** 오늘 9:30 AM (전시 시작 시간)

```bash
cd "/Users/dahyung/Code Repo/Energy"
./START_EXHIBITION_BLE.sh
```

**확인 사항:**
- 로그에서 `📅 데이터 수집: 타겟 날짜: X-X-X (KST) - 어제 데이터를 오늘 같은 시간에 표시` 확인
- `✅ Found X messages` 메시지로 데이터 로드 확인
- LED 전광판에 메시지가 표시되는지 확인

**종료:** 오늘 5:30 PM (전시 종료 시간) 또는 `Ctrl + C`

---

## 📊 데이터 흐름

1. **어제 한국 9:30 AM - 5:30 PM**: 기상 데이터 수집 (이미 완료)
2. **어제 저녁 (미국 시장 개장)**: 
   - 어제 한국 데이터로 트레이딩 시작
   - 1분마다 BLE Display 시트에 로깅
3. **오늘 9:30 AM - 5:30 PM**:
   - BLE Display 시트에서 어제 데이터 읽기
   - LED 전광판에 표시

---

## ⚙️ 환경 변수 확인

필요한 환경 변수들이 설정되어 있는지 확인:

```bash
echo "GOOGLE_CREDENTIALS: $(echo $GOOGLE_CREDENTIALS | head -c 50)..."
echo "GOOGLE_SPREADSHEET_ID: $GOOGLE_SPREADSHEET_ID"
echo "ALPACA_API_KEY: $(echo $ALPACA_API_KEY | head -c 20)..."
echo "ALPACA_SECRET_KEY: $(echo $ALPACA_SECRET_KEY | head -c 20)..."
```

---

## 🎯 일일 체크리스트

### 매일 저녁 (미국 시장 개장 전)
- [ ] 터미널 1에서 `./START_SERVER.sh` 실행
- [ ] 서버 로그에서 데이터 로드 확인
- [ ] 트레이딩 시작 확인

### 매일 아침 9:30 AM (전시 시작)
- [ ] 터미널 2에서 `./START_EXHIBITION_BLE.sh` 실행
- [ ] LED 전광판에 메시지 표시 확인
- [ ] 2개 메시지 시퀀스 (기상 + 트레이딩) 확인

### 매일 오후 5:30 PM (전시 종료)
- [ ] LED 전송 스크립트 종료 (`Ctrl + C`)

---

## 🔧 문제 해결

### 트레이딩이 안 되는 경우
1. 서버 로그 확인: `🔄 한국 기상 데이터로 미국 시장 트레이딩` 메시지 확인
2. 데이터 확인: `📊 Loaded X sensor readings` 메시지 확인
3. 시장 시간 확인: EST 9:30 AM - 4:00 PM (월-금)

### LED 전광판에 메시지가 안 나오는 경우
1. BLE Display 시트에 데이터가 있는지 확인
2. `sendBLEReplaySync.js` 로그 확인
3. BLE 디바이스 연결 확인

---

**준비 완료! 이제 시스템을 실행하면 됩니다.** 🚀

