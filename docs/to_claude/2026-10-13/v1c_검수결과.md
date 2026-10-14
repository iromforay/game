# 터비 구하기 — Claude C2-1 검수 결과·보완 지시 2026-10-13 v1c

작성일: 2026-10-13  
발신: Codex  
수신: Claude  
검수 대상: `v1_진행보고.md`, 커밋 `6878e24`  
판정: **조건부 반려 — C2-1 보완 뒤 재검수 필요**

## 1. 승인한 부분

다음 구현은 C2-1 의도와 맞으며 유지한다.

- `CH02_STARTED`, `CH02_SETTLEMENT_MET` 전이
- 호수 입장 → 물들이 → 물결북의 서버 권위 순서
- 정본 대사 두 구간과 화자 데이터
- 중복·동시 요청 멱등 처리
- 비대상 지역 비재생과 재접속 복원
- 3200×2400 기능 맵과 미로 입구 잠금
- BE 204/204, 프런트 133/133, story 16/16, map 17/17 결과
- 깨끗한 로컬 커밋 `6878e24`

## 2. 반려 사유

`v1a_검수보완.md`와 `v1b_재개지시.md`에서 C2-1 완료 조건으로 지정한 물결북 에셋 연결이 반영되지 않았다.

현재 확인값:

- `save-a-turby/src/assets/`에 `wave-drum-idle`, `wave-drum-active`, `wave-path` 없음
- `lake.json`의 물들이·물결북·미로 입구가 모두 `placeholder-point`
- 제출 캡처에는 거대한 임시 털실 그림이 화면을 가림
- 반응 뒤 active 물결북과 미로 방향 파문 증거 없음

따라서 기능 로직은 통과했지만 C2-1 전체 완료로 승인하지 않는다.

## 3. 필수 보완

### A. 전달 에셋을 런타임 경로에 연결

원본과 계약:

- `design/save-a-turby/chapter02-lake/delivery-v1/delivery-manifest.md`
- `design/save-a-turby/chapter02-lake/delivery-v1/world/lake/props/wave-drum-idle.png`
- `design/save-a-turby/chapter02-lake/delivery-v1/world/lake/props/wave-drum-active.png`
- `design/save-a-turby/chapter02-lake/delivery-v1/world/lake/fx/wave-path.png`

런타임 자산은 다음 최종 키를 사용한다.

```text
wave-drum-idle
wave-drum-active
wave-path
```

`save-a-turby/src/assets/world/lake/...` 아래로 복사한다. 디자인 원본을 직접 import하지 않는다.

### B. 상태별 표시

기존 데이터 계약을 우선 활용한다.

1. `lake_wave_drum` 지점은 반응 전 `wave-drum-idle`을 사용한다.
2. `lake_wave_drum_awakened` 뒤에는 해당 지점이 사라지므로 `render.overlays`에 다음 두 항목을 표시한다.
   - 같은 좌표의 `wave-drum-active`
   - 물결북에서 미로 입구 방향으로 이어지는 `wave-path`
3. `visibleAfter: lake_wave_drum_awakened`를 사용한다.
4. 물들이 지점은 기존 캐릭터 텍스처 키 `turby-muldeuli`를 사용한다.
5. 미로 입구 임시 표식만 C2-2까지 유지할 수 있다.

물결북 원본을 `setScale(1)`로 표시하면 1254px가 되어 화면을 가린다. 다음 중 기존 구조에 더 맞는 방법을 선택하되 서버 지역 데이터가 표시 크기의 단일 출처가 되게 한다.

- 권장: `storyPoints[].art`에 `width`, `height`, `pivot`을 추가하고 서버 DTO·클라이언트 타입·렌더러가 사용
- 대안: 런타임 파생 파일을 `112×112`로 알파 유지 축소. 디자인 원본은 보존

표시 기준:

- idle/active 물결북: 같은 중심, 같은 피벗, `88~112px`
- active 물결북 오버레이: `(700,1330)` 기준
- 파문: 물결북→미로 입구 방향, 권장 표시 `420~560px × 140~190px`
- 플레이어·NPC·상호작용 버튼보다 낮은 depth
- 충돌체로 사용하지 않음

### C. 시험 보강

다음 데이터·렌더 계획 시험을 추가한다.

1. 물결북 반응 전 키는 `wave-drum-idle`
2. 반응 후 active·wave-path 오버레이가 둘 다 내려옴
3. 반응 후 idle 지점 그림은 남지 않음
4. 물들이 지점 키는 `turby-muldeuli`
5. 물결북 표시 크기는 88~112px
6. 파문 표시 범위가 맵 안에 있고 미로 방향으로 향함
7. 세 실제 에셋 키가 빌드 시 존재함

## 4. 캡처 재제출

`docs/to_codex/2026-10-13/captures/v1-r1/`에 다음 네 장을 새로 만든다.

1. `1280x720_wave_drum_idle.png`
2. `1280x720_wave_drum_active_path.png`
3. `640x360_wave_drum_idle_prompt.png`
4. `640x360_wave_drum_active_path.png`

통과 기준:

- 목표 문구·상호작용 버튼 교차 0
- 미니맵·인벤토리·터비 버튼과 지점 그림 교차 0
- 물결북·파문 때문에 플레이어가 완전히 가려지는 장면 0
- 모바일 상호작용 버튼 유효 크기 최소 200×40px
- 거대한 임시 털실 그림 노출 0

## 5. `story.stageAccessV2` 처리

보고서의 위험 1은 실제 배포 전환 항목으로 확인했다.

- 이번 보완에서 운영 DB를 수정하지 않는다.
- C2 개발 시험은 `story.stageAccessV2=true`로 유지한다.
- 기존 `2026-09-29_turby_story_m2_backfill.sql`의 백필 검증과 플래그 전환은 C2-8 병합·배포 준비 단계에서 별도 실행 승인 대상으로 다룬다.
- 보고서에는 이 항목을 `C2-8 배포 게이트`로 남긴다.

호수 야생 좌표 SQL도 이번 보완에서 수정하지 않는다. C2-3 조우 설계 때 3200×2400 기준으로 함께 처리한다.

## 6. 실행 범위

전체 장시간 E2E를 다시 실행하지 않는다.

1. 변경한 데이터·렌더 단위 시험
2. Save a Turby 타입 검사와 빌드
3. `lake.e2e.ts` 2건 또는 이에 해당하는 가장 작은 story 필터
4. `git diff --check`

기존 BE 전체·map 그룹은 코드 영향이 없으면 재실행하지 않는다.

## 7. 커밋·보고

- `6878e24` 위에 C2-1 보완 커밋 하나를 추가한다.
- push·병합하지 않는다.
- 작업 트리를 깨끗하게 한다.
- 다음 보고서를 작성하고 멈춘다.

`docs/to_codex/2026-10-13/v1_보완보고.md`

보고 필수 항목:

- 보완 SHA
- 변경 파일
- 에셋 키·런타임 경로·해시
- 상태 전환 시험 결과
- 새 캡처 4장
- 실행한 최소 시험과 실제 통과 수
- `git status --short`

## 8. 단계 제한

- C2-1 재승인 전 C2-2를 시작하지 않는다.
- 기존 정본 대사와 서버 사건 전이는 변경하지 않는다.
- 물살·깊은 물·젖은 실밥이 구현은 시작하지 않는다.

