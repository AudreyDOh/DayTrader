# 🎨 프론트엔드 디스플레이 구조

`daytrader.onrender.com`의 디스플레이는 `public/index.html` 파일에 있습니다.

---

## 📁 파일 위치

```
public/
  ├── index.html          ← 메인 HTML (디자인, 레이아웃, 스타일 모두 포함)
  ├── script.js           ← (사용 안 함, 백엔드용)
  └── client-script.js    ← (사용 안 함)
```

---

## 🏗️ HTML 구조

### 1. 상단 헤더
```html
<div class="dashboard-header">
    <h1>실시간 대시보드</h1>
    <p>마지막 업데이트</p>
</div>
```

### 2. 탭 네비게이션
```html
<ul class="nav nav-tabs">
    <li>태양광 센서 데이터</li>
    <li>Alpaca 포트폴리오</li>
</ul>
```

### 3. 태양광 센서 데이터 탭
```html
<div id="solar-content">
    - 날씨 무드
    - 시장 상태
    - 센서 값들 (조도, 온도, 습도, 전류, 전력, 배터리)
    - 추천 종목
    - 최근 센서 기록 테이블
</div>
```

### 4. Alpaca 포트폴리오 탭
```html
<div id="alpaca-content">
    - 포트폴리오 차트
    - 계좌 요약 (순자산, 매수 가능 금액, 현금)
    - 상위 보유 종목
    - 최근 주문
</div>
```

### 5. 히어로 섹션 (하단)
```html
<header class="solar-hero">
    - 태양 이미지
    - "Day Trader" 제목
    - 프로젝트 설명
</header>
```

### 6. 태양 거래 로직 섹션
```html
<section class="ritual-explainer">
    - 섹션 제목
    - 설명 텍스트
    - 4개의 카드 (조도, 습도, 온도, 전력)
</section>
```

---

## 🎨 CSS 스타일

모든 스타일은 `index.html` 파일 내부의 `<style>` 태그에 있습니다 (13-405줄).

### 주요 색상 변수
```css
--solar-amber: #d8a250
--solar-sand: #f7edd4
--solar-rose: #c05c43
--solar-ink: #1f1d1b
--ticker-green: #46fcb7
--ticker-red: #ff6b6b
```

### 주요 클래스
- `.dashboard-container` - 전체 컨테이너
- `.ritual-shell` - 메인 카드 스타일
- `.solar-hero` - 히어로 섹션
- `.solar-data` - 센서 데이터 섹션
- `.element-card` - 각 센서 카드
- `.sensor-readings` - 센서 값 그리드

---

## 📝 수정 방법

### 1. 레이아웃 변경
`index.html`에서 HTML 구조를 재배열하세요.

### 2. 디자인 변경
`<style>` 태그 내의 CSS를 수정하세요.

### 3. 콘텐츠 변경
HTML 내의 텍스트를 직접 수정하세요.

---

## 🔧 주요 수정 포인트

### 섹션 순서 변경
현재 순서:
1. 대시보드 헤더
2. 탭 네비게이션
3. 센서 데이터 / 포트폴리오 탭
4. 히어로 섹션 (하단)
5. 태양 거래 로직 섹션

**재배열하려면:** HTML 블록을 이동하세요.

### 스타일 변경
- 색상: `:root` 변수 수정
- 레이아웃: `.dashboard-container`, `.solar-hero` 등 수정
- 카드 스타일: `.element-card`, `.sensor-item` 등 수정

---

## 💡 빠른 수정 가이드

1. **섹션 순서 변경**: HTML 블록을 드래그 앤 드롭
2. **색상 변경**: `:root` 변수 수정
3. **레이아웃 변경**: CSS `grid-template-columns`, `flex-direction` 등 수정
4. **텍스트 변경**: HTML 내 텍스트 직접 수정

