# 내 자산관리

개인용 자산관리 웹앱. **데이터는 내 Google Drive에만 저장되고, 거쳐 가는 서버가 없다.**

- 앱 코드(HTML/JS)는 GitHub Pages가 내려준다
- 금융 데이터는 브라우저 ↔ 내 Drive(`/Asset Manager/data.json`) 사이에서만 오간다
- 요청하는 권한은 `drive.file` 하나 — 앱이 만든 파일과 내가 직접 고른 파일 외에는 접근 불가

## 디렉터리

```
asset-manager/
  docs/
    01-원본-분석.md      참고한 서비스의 기능·화면 역설계 결과
    02-구현-방침.md      원본과 같게 갈 것 / 다르게 갈 것, 통화 처리 설계
    04-google-설정.md    Google Cloud OAuth 설정 안내 (먼저 읽을 문서)
  web/                   소스 (Vite + React + TypeScript)
  app/                   빌드 산출물 — GitHub Pages가 이 폴더를 서빙하므로 커밋한다
```

## 배포 주소

```
https://eastar80.github.io/study/asset-manager/app/
```

Pages가 기본 브랜치(`main`)의 루트를 서빙하므로, 작업 브랜치의 변경은 `main`에 병합된 뒤 반영된다.

## 개발

```bash
cd asset-manager/web
npm install
npm run dev        # http://localhost:5173
npm test           # 패턴 인식기 단위 테스트
npm run build      # ../app 에 산출물 생성 (반드시 커밋)
```

`app/` 은 빌드 산출물이지만 **커밋 대상이다.** Pages 워크플로 없이 브랜치 루트를 서빙하는 구성이라
빌드 결과가 저장소에 있어야 배포된다. 소스를 고쳤으면 `npm run build` 후 함께 커밋한다.

## 첫 실행

1. `docs/04-google-설정.md` 를 따라 OAuth 클라이언트 ID와 API 키를 발급한다
2. 앱의 **환경 설정** 화면에 두 값을 붙여 넣는다 (브라우저에 저장되므로 재빌드 불필요)
3. **Drive 연결** → **시트 분석** 에서 기존 자산 시트를 골라 구조 보고서를 확인한다

빌드 시점에 값을 박아 넣으려면 `web/.env.local` 에 넣어도 된다.

```
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
VITE_GOOGLE_API_KEY=AIza...
```

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | Google 연동 + 시트 구조 분석기 + Drive 저장소 + 앱 셸 | 완료 |
| 2 | 스키마 확정 + 시트 임포터 | 구조 보고서 대기 |
| 3 | 자산 대장 그리드 (행=항목 / 열=월) | 예정 |
| 4 | 대시보드 (KPI·구성비·통화별 현황·부채 상세·추이) | 예정 |
| 5 | 포트폴리오 + 시세·환율 프록시 | 예정 |
| 6 | 타임라인, 목표 계산기 | 예정 |

가계부 모듈과 관리자 기능은 구현하지 않는다. 사유는 `docs/02-구현-방침.md` 3.1 참조.
