# game

웹 게임 모노레포. 하나의 게임 허브(hub)에서 여러 개의 독립된 게임을 카드 형태로 골라 실행하는 구조다.

## 개발 방식

이 프로젝트는 **100% AI 에이전트(Claude Code, Codex) 기반으로 구현(바이브 코딩)**한 결과물이다.
기획, 아키텍처 설계, 작업 지시, 코드/화면 리뷰, QA는 직접 수행했으며, 실제 코드 구현은 AI 에이전트에게 맡기고 결과를 검증·보정하는 방식으로 진행했다.

실제 AWS 환경에 배포해 **1개월간 클로즈 베타**를 진행했다.

## 기술 스택

| 영역 | 스택 |
|---|---|
| BE | NestJS (+ Socket.IO 기반 WebSocket) |
| FE (허브/일부 게임) | React + Vite |
| FE (일부 게임) | Phaser (2D 게임 엔진), Three.js(그린 트래킹·컬러 블래스터즈 3D) |
| DB | MariaDB (Prisma ORM, `provider: mysql`) |
| Pub/Sub | Redis (`@socket.io/redis-adapter`로 Socket.IO 서버 간 이벤트 브로드캐스트) |

- 실시간 대전/멀티플레이가 있는 게임(터비 구하기, 커비 훔치기, 달콤상점, 컬러 블래스터즈 등)은 `socket.io-client`로 BE WebSocket에 접속한다.
- 게임별 FE 구현체는 Phaser(2D 액션형) 또는 React(UI/보드형)로 나뉘며, 허브는 React + Vite 기반이다.

## 전체 구조

```
game/
├── hub/              게임 허브 — 로비, 계정/로그인, 도감(커비·터비), 랭킹, 관리자 화면
├── BE/               백엔드 서버 (API, DB — Prisma), 운영 배포 스크립트(deploy-be.sh), pm2 실행(run.bat)
├── app/              허브를 TWA(Trusted Web Activity)로 패키징한 Android 앱 빌드(Gradle)
├── shared/           게임 간 공유 모듈
│   ├── turby-stage-geometry/   터비 구하기 스테이지 좌표 공용 로직
│   └── sweet-shop-contracts/   달콤상점 API 타입 공용 계약
├── docs/             기획서, 설계 문서, 운영 문서, 스토리 원본 등
├── design/           게임별 비주얼/컨셉 디자인 산출물
├── test/             게임별 통합 테스트(Node test runner)
├── scripts/          전체 게임 테스트 실행 등 공용 스크립트
├── download/         배포용 APK 등 산출물
└── <게임 폴더들>      아래 "게임 목록" 참조
```

- npm workspaces 모노레포(`package.json`)로 각 게임·공유 패키지·BE·hub를 하나의 저장소에서 관리한다.
- 공통 명령: `npm run test:all`(전체 테스트), `npm run build:shared`(공유 패키지 빌드), `npm run verify:release-games`(출시 대상 게임 테스트+빌드).

## 게임 목록

### 허브 메인 게임 (hub 로비 카드, `hub/src/games.ts`)

| 폴더 | 게임 | 한 줄 설명 |
|---|---|---|
| `tower-defense` | 디펜스타워 | 몰려오는 적, 타워로 막아라 |
| `offense-tower` | 오펜스 타워 | AI의 방어를 뚫고 돌파하라 |
| `strategy-marbles` | 전략 알까기 | 무게를 숨기고 상대를 쳐내라 |
| `save-a-turby` | 터비 구하기 | 엄마의 마지막 한 타래를 찾아 떠나는 모험 (스토리 완결) |
| `steal_a_kirby` | 커비 훔치기 | 내 기지는 지키고, 남의 기지는 털어라 |

### 미니게임 (hub 내 "미니게임" 카탈로그, `hub/src/adGames.ts`)

| 폴더 | 게임 | 한 줄 설명 |
|---|---|---|
| `number-gate-runner` | 숫자 게이트 러너 | 숫자 게이트로 소대를 키우고 기계 군단을 격파 |
| `number-hero-tower` | 숫자 용사 탑 | 공격 숫자와 경로 폭을 판단해 드래곤에 도전 |
| *(hub 내부 구현, 별도 폴더 없음)* | 머지 디펜스 | 검사·궁사·마검사를 스폰·합성해 태엽 군단을 막는 디펜스 (`hub/src/MergeDefense*`) |
| `sweet-shop` | 달콤상점 | 디저트를 만들어 다른 플레이어와 사고파는 온라인 카페 운영 |
| `my-room-dungeon` | 내 방이 던전 | 방 안 사물을 분해해 자원을 모으고 무기·채집 로봇 성장 |
| `color-blasters` | 컬러 블래스터즈 | 페인트탄으로 AI와 부위 점령을 다투는 컬러 스포츠 대전 (현재 운영 서비스 대상 아님) |
| `spin-gather-king` | 빙글 채집왕 | 회전 도구로 나무·돌을 모아 채집 구역 건설 |
| `green-tracking` | 그린 트래킹 | 고해상도 3D 숲길을 걷는 힐링 산책 실험(MVP) |

> 게임별 상세 진행 상황과 설계 결정은 각 게임의 `docs/dev` 문서와 메모리를 참고.
