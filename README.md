# study

개인 프로젝트 모음. 정적 웹앱 세 개가 GitHub Pages로 배포된다.

## 배포

**GitHub Pages는 `main` 브랜치의 루트(`/`)를 서빙한다.**
저장소 → Settings → Pages 에서 Source `Deploy from a branch`, Branch `main` / `/ (root)`.

빌드 워크플로 없이 브랜치를 그대로 내보내는 방식이므로, **빌드가 필요한 앱은 산출물을 커밋해야
배포된다.** 소스만 고치고 빌드 결과를 빼먹으면 사이트는 예전 화면을 계속 보여준다.

| 앱 | 주소 | 소스 | 빌드 |
|---|---|---|---|
| 나의 대시보드 (날씨·코스피) | [`/study/`](https://eastar80.github.io/study/) | 루트 `index.html`, `script.js`, `style.css` | 없음 |
| 자산관리 | [`/study/asset-manager/app/`](https://eastar80.github.io/study/asset-manager/app/) | `asset-manager/web/` | **필요** → `asset-manager/app/` |
| 주식 대시보드 | [`/study/stock-dashboard/`](https://eastar80.github.io/study/stock-dashboard/) | `stock-dashboard/` | 없음 |
| 주사위 시뮬레이터 | [`/study/dice-simulator/`](https://eastar80.github.io/study/dice-simulator/) | `dice-simulator/` | 없음 |

## 자산관리

개인 자산 대장과 대시보드. **금융 데이터는 사용자 본인의 Google Drive에만 저장되고, 거쳐 가는
서버가 없다.** 요청 권한은 `drive.file` 하나로, 앱이 만든 파일과 사용자가 직접 고른 파일 외에는
Drive에 접근하지 못한다.

시작하려면 `asset-manager/docs/04-google-설정.md` 를 먼저 읽고 OAuth 클라이언트 ID와 API 키를
발급한다. 자세한 내용은 [`asset-manager/README.md`](asset-manager/README.md).

```bash
cd asset-manager/web
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # ../app 에 산출물 생성 — 반드시 함께 커밋
```
