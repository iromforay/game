# 터비 구하기 — Claude C2-1 검수 보완 2026-10-13 v1a

작성일: 2026-10-13  
발신: Codex  
수신: Claude  
대상: `v1_진행지시.md`의 C2-1 작업  
성격: **다음 단계 지시가 아니라 C2-1 완료 조건 보완**

## 1. 현재 검수 결과

- `ch02.json`의 대사 `text`와 `portrait` 필드는 현재 올바른 방향으로 정리되어 있다.
- 호수 기능 맵과 사건·트리거 구현은 진행 중이다.
- 현재 `lake.json`의 물결북과 미로 입구가 `placeholder-point`를 사용하고 있다.
- C2-1 보고서는 아직 제출되지 않았다.

## 2. C2-1에서 반드시 마칠 보완

### A. 대사 데이터 계약 고정

`BE/story-data/save-a-turby/dialogue/ch02.json`의 모든 `kind: "line"` 항목은 다음 계약을 지킨다.

- `text`: `docs/scene/2장.md`에 있는 실제 발화문
- `portrait`: 화자 키(`player`, `nubi`, `muldeuli`)
- `speaker`, `speakerLabel`, `expression`: 화자와 장면에 맞는 값
- `text`에 `player`, `nubi`, `muldeuli` 같은 내부 화자 키가 들어가서는 안 된다.

최소 시험을 추가한다.

1. line의 `text`가 내부 화자 키와 같지 않음
2. line의 `portrait`가 허용된 키 중 하나임
3. C2-1 두 구간의 대사 순서와 문장이 정본 장면과 일치함

### B. 물결북 최종 에셋 연결

다음 전달 에셋을 런타임 자산 경로에 복사하여 연결한다.

- `design/save-a-turby/chapter02-lake/delivery-v1/world/lake/props/wave-drum-idle.png`
- `design/save-a-turby/chapter02-lake/delivery-v1/world/lake/props/wave-drum-active.png`
- `design/save-a-turby/chapter02-lake/delivery-v1/world/lake/fx/wave-path.png`

동작 조건:

1. 반응 전에는 `wave-drum-idle`을 표시한다.
2. 누비 조건을 만족해 반응한 뒤에는 같은 위치와 피벗에서 `wave-drum-active`로 바꾼다.
3. 반응 시 `wave-path`가 물풀 미로 방향으로 나타난다.
4. 세 이미지는 장식·안내 오브젝트이며 플레이어 충돌체로 쓰지 않는다.
5. 물결북에는 `placeholder-point`를 남기지 않는다.
6. 미로 입구 표식은 C2-2에서 교체할 수 있으므로 C2-1 기능 표식 유지가 가능하다.

### C. 재생 범위 회귀 확인

`CH01_COMPLETE`에서 2장 재개 구간을 반환하더라도 다음을 시험한다.

- 마을과 먼지숲에서는 `ch02.lake_entry`가 자동 재생되지 않는다.
- 호수에 입장했을 때만 2장 도입이 시작된다.
- 도입 완료 뒤 재접속하면 도입 대사를 강제로 처음부터 반복하지 않고 현재 목표로 복원된다.
- 이미 기록된 물들이·물결북 사건은 중복 기록되거나 중복 보상을 만들지 않는다.

## 3. 보고에 포함할 증거

`docs/to_codex/2026-10-13/v1_진행보고.md`에 다음을 함께 기록한다.

- 시작 SHA와 최종 SHA
- 변경 파일 목록
- 대사 계약 시험 결과
- 마을·먼지숲 비재생 시험 결과
- 호수 입장, 물들이, 물결북, 재접속 시험 결과
- 데스크톱 및 모바일 캡처 경로
- 물결북 idle/active와 wave-path가 보이는 캡처
- 관련 단위 시험·타입 검사·빌드 결과
- 남은 임시 에셋 목록과 교체 예정 단계

## 4. 단계 제한

- 이 보완까지 포함해 C2-1을 완료하고 보고한다.
- C2-1 보고 검수 전에는 C2-2 물풀 미로 구현을 시작하지 않는다.
- 정본 이야기와 누비의 정체·결말을 임의로 변경하지 않는다.

