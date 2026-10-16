# 터비 구하기 — Claude C2-2 검수 결과·보완 지시 2026-10-13 v2a

작성일: 2026-10-13  
발신: Codex  
수신: Claude  
검수 대상: `v2_진행보고.md`, 커밋 `85caaad`  
판정: **조건부 반려 — 사건 의미 보완 뒤 재검수**

## 1. 승인한 부분

다음 구현은 C2-2 의도에 맞으므로 유지한다.

- 물풀문 closed/open 서버 충돌 계약과 에셋 연결
- 얕은 물·깊은 물·약한/강한 물살·안전 앵커 데이터
- 서버 권위 물살 밀림과 위조 입력 무시
- cooldown 1,200ms, 연속 2회, 깊은 물 복귀 보호 1,500ms
- 깊은 물 복귀와 플레이어별 물 상태 분리
- 재접속 시 서버 확정 위치·유효 앵커 복원
- `current-flow`, `reed-gate-closed`, `reed-gate-open` 런타임 연결
- BE 224/224, 프런트 141/141, 호수 E2E 5/5, map E2E 17/17 보고
- 제출 캡처 4장의 기능 가독성
- C2-3 적·구조·체크포인트를 선행 구현하지 않은 점

기능 회색상자의 검은 벽과 텍스트는 C2-7 최종 미술 대상이며 이번 반려 사유가 아니다.

## 2. 반려 사유 — `lake_safe_route_opened` 의미 충돌

`docs/implementation/story/story_checkpoint_spec.md` 7.1~7.2와 `docs/scene/2장.md`의 물풀 미로 구간은 다음 순서를 정본으로 둔다.

```text
물결북 반응
→ 물풀 미로 진입
→ 붙잡힌 물들이 구조
→ 안전 물길 개방
→ CH02_MAZE_CLEARED
```

정본 이벤트 의미:

```text
lake_wave_drum_awakened       물결북 반응
lake_trapped_turbies_rescued  붙잡힌 물들이 구조
lake_safe_route_opened        구조 뒤 안전 물길 영구 개방
```

현재 `85caaad`는 `lake_wave_drum_awakened`의 `alsoComplete`로 `lake_safe_route_opened`를 즉시 기록한다. 이 상태에서는 C2-3 구조 전부터 안전 물길 개방 사건이 완료되어 정본 순서와 영속 상태가 충돌한다.

이 문제는 Codex가 v2 지시서에서 사건명을 잘못 고정해 발생했다. 구현자의 임의 변경으로 판정하지 않는다.

## 3. 보완 방법

새 영구 사건을 추가하지 않는다. 미로 **입구 문**은 이미 완료된 `lake_wave_drum_awakened`에서 직접 파생한다.

1. `lake_wave_drum_awakened`의 `alsoComplete`에서 `lake_safe_route_opened`를 제거한다.
2. 미로 입구 문 `gate_reed_maze`의 개방 조건은 `lake_wave_drum_awakened`로 바꾼다.
3. 두 물살의 `requires`도 `lake_wave_drum_awakened`로 바꾼다.
4. `lake_safe_route_opened`는 이번 단계에서 기록·요구·표시 조건으로 사용하지 않는다.
5. `lake_safe_route_opened`의 정본 의미는 C2-3에서 붙잡힌 물들이 구조 뒤 열리는 **미로 내부 안전 물길**로 보존한다.
6. 기존 `CH02_SETTLEMENT_MET` 개발 계정은 `lake_wave_drum_awakened`가 있으므로 별도 백필 없이 미로 입구가 열린다.

이 보완에서는 C2-3 내부 안전 물길의 좌표·문·에셋 상태를 아직 만들지 않는다.

## 4. 시험 수정

다음을 고정한다.

1. `lake_wave_drum_awakened` 전: 미로 입구 문 닫힘
2. `lake_wave_drum_awakened` 후: 입구 문 열림
3. 물결북 완료 뒤에도 `lake_safe_route_opened`는 기록되지 않음
4. 물살은 `lake_wave_drum_awakened`가 있는 플레이어에게 적용
5. 직접 `lake_safe_route_opened` 요청은 계속 서버 전용 거부
6. 기존 C2-2 재접속·깊은 물·다인 독립 시험 유지

## 5. 실행 범위

전체 E2E와 map 그룹을 다시 실행하지 않는다.

1. 변경한 BE·프런트 단위 시험
2. `lake.e2e.ts`와 `lake-maze.e2e.ts` 중 사건명을 단언하는 최소 필터
3. BE·Save a Turby 타입 검사
4. `git diff --check`

좌표·에셋·렌더가 바뀌지 않으므로 캡처 4장은 재제출하지 않아도 된다.

## 6. 커밋과 보고

- `85caaad` 위에 보완 커밋 하나를 추가한다.
- push·병합·배포하지 않는다.
- 작업 트리를 깨끗하게 한다.
- 다음 경로에 보고하고 멈춘다.

`docs/to_codex/2026-10-13/v2_보완보고.md`

보고 항목:

1. 보완 SHA
2. 사건·문·물살 조건 변경표
3. 물결북 뒤 `lake_safe_route_opened` 미기록 시험
4. 최소 시험·타입 검사 결과
5. 변경 파일
6. `git status --short`

## 7. 단계 제한

- C2-2 재승인 전 C2-3을 시작하지 않는다.
- 좌표·물살 수치·에셋을 다시 조정하지 않는다.
- `lake_trapped_turbies_rescued`, `lake_safe_route_opened`, `CH02_MAZE_CLEARED`를 완료시키는 C2-3 구현을 시작하지 않는다.

