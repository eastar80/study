# 행운의 3D 주사위

실제 정육면체 구조의 주사위 두 개를 3D 애니메이션과 함께 굴리는 웹 페이지입니다.
각 주사위의 반대면은 항상 `1–6`, `2–5`, `3–4`로 구성됩니다.
따라서 동시에 보이는 세 면 안에는 합이 7인 두 면이 함께 나타나지 않습니다.

## GitHub Pages

정적 파일만 사용하는 앱이므로 저장소의 `main` 브랜치를 GitHub Pages로 배포할 수 있습니다.

`index.html`을 브라우저에서 열거나 아래 명령으로 로컬 서버를 실행하세요.

```powershell
python -m http.server 8000 -d dice-simulator
```

그런 다음 `http://localhost:8000`에 접속합니다.
