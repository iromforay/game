# 터비 구하기 브라우저 E2E

실제 게임 클라이언트(Vite 개발 서버) + 실제 터비 Nest 앱(테스트 FakeDb) + 설치된 Chrome으로 화면을 직접 조작해 검증한다. 운영 DB와 `.env`는 쓰지 않는다.

## 실행

```bash
cd BE
npm run test:e2e
```

- 서버·프런트는 테스트가 임의 포트로 띄우고 끝나면 내린다. 테스트마다 새 DB라 서로 영향이 없다.
- UI 행동(클릭·키 입력)은 **한 번만** 한다. 누른 뒤 기대 상태가 오지 않으면 다시 누르지 않고 `입력 누락`으로 실패한다.
- 실패하면 `test/e2e/.artifacts/<테스트>.json`·`.png`에 장면·체크포인트·최근 오류 코드·스크린샷이 남는다(git 제외, 토큰·식별 정보 없음).

## 브라우저 경로(CHROME_PATH)

브라우저를 내려받지 않고 설치된 Chrome 또는 Edge를 쓴다. 기본 설치 경로에서 못 찾으면 실행 파일 경로를 `CHROME_PATH`로 지정한다.

```powershell
$env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"; npm run test:e2e
```

```bash
CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
```

CI에서도 같은 방식이다(Chrome이 설치된 러너 + `CHROME_PATH`). CI 설정 파일은 이 저장소에 두지 않았다.

## 선택 환경 변수

| 변수 | 뜻 |
|---|---|
| `CHROME_PATH` | 브라우저 실행 파일 경로 |
| `E2E_CAPTURE_DIR` | 지정하면 검증 장면의 캔버스 캡처를 이 폴더에 저장 |
| `E2E_ARTIFACT_DIR` | 실패 진단 저장 위치(기본 `test/e2e/.artifacts`) |
| `E2E_HEADED=1` | 브라우저 창을 띄워서 실행 |

## 파일

- `harness.ts` — 서버·프런트·브라우저 기동, 실제 입력(클릭·방향키·조이스틱), 상태 기다림, 실패 진단
- `fixtures.ts` — 테스트 DB에 계정 상태 준비(첫 매듭 준비, 터비 여러 마리, 상점, 지역 5곳)
- `ch01.e2e.ts` — 1장 흐름(오프닝 → 전투 → 인벤토리·첫 매듭 → 일반 전투)
- `screens.e2e.ts` — 지역 선택·상점·장비·마을 HUD·이름 입력과 화면별 resize
- `input.e2e.ts` — 한 번의 입력이 빠지지 않는지(다시 그린 같은 프레임, 느린 응답, 예전 응답)
- `hub.e2e.ts` — 허브 임베드
