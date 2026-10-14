# 터비 구하기 2장 — 어항 속 호수 에셋 계약 v1

작성일: 2026-10-13  
상태: 기능 맵·최종 미술 공통 기준 초안  
정본: `docs/story/chapter_02_lake.md`, `docs/scene/2장.md`

## 1. 전체 구조

- 월드 크기: `3200×2400`
- 구성: 한 장짜리 단일 연속 사냥터
- 배경: 작은 타일 반복 없이 대형 비반복 이미지 한 장
- 진행 상태가 바뀌는 오브젝트와 효과만 투명 PNG로 분리
- 최종 배경에는 캐릭터, 적, 수집물, 목표 표식, UI를 굽지 않는다.

콘셉트 기준:

`concept-v1/chapter02-lake-map-concept-v1.png`

콘셉트 원본은 1448×1086이며 런타임 이미지가 아니다. 최종 배경은 별도 제작·검수한다.

## 2. 구역 배치

월드 좌표는 3200×2400 기준의 기능 배치 범위다. 최종 미술에서 범위 안의 세부 좌표를 조정할 수 있지만 구역 순서는 바꾸지 않는다.

| 구역 | 권장 중심 | 권장 범위 | 역할 |
|---|---:|---:|---|
| 숲 연결 입구 | `(380, 2040)` | x 120~700, y 1750~2280 | 1장에서 이어지는 시작 지점, `CH02_STARTED` |
| 호숫가 정착지 | `(820, 1220)` | x 400~1250, y 760~1650 | 물들이 조우, 물결북, 안전 구역 |
| 물풀 미로 | `(1760, 1380)` | x 1250~2350, y 650~2100 | 물살·얕은 물·젖은 실밥이·구조 목표 |
| 염색 샘 | `(2700, 600)` | x 2350~3100, y 160~1050 | 위기 진입, 보스 공터, 물빛 염색실 |

주 동선은 `입구 → 정착지 → 물풀 미로 → 염색 샘` 한 방향으로 읽혀야 한다. 지름길은 이야기 진행으로 열 수 있지만 별도 로딩 맵으로 나누지 않는다.

## 3. 가독성 수치

- 주 이동로 시각 폭: 최소 180px
- 모바일 한 화면에서 다음 갈림길 하나와 방향 단서 하나가 함께 보여야 함
- 정착지 중앙 안전 공간: 지름 최소 420px
- 물풀 미로 통로: 180~260px
- 염색 샘 전투 공터: 지름 최소 720px
- HUD 안전영역과 월드 목표 표식 교차: 0
- 이동 가능 영역과 깊은 물의 명도·채도 차이를 50% 축소에서도 식별 가능하게 유지
- 물살 방향은 애니메이션 없이 정지 화면에서도 흐름이 읽히는 곡선 결로 표현하되 화살표는 사용하지 않음

## 4. 배경과 상태 오브젝트 분리

### 배경에 포함

- 유리벽과 굴절광
- 깊은 물과 얕은 물의 기본 색면
- 고정 섬·모래길·해안선
- 정착지의 고정 천막·부두
- 미로의 고정 물풀 군락
- 염색 샘 외곽 구조

### 투명 오브젝트로 분리

- 물결북 반응 전·후
- 닫힌 물풀 장벽과 열린 안전 물길
- 검은 실 덫
- 구출 전·후 물들이
- 색을 잃은 구역과 복구된 구역 오버레이
- 보스 검은 재봉실과 약점 노출 상태
- 물살 효과
- 물빛 염색실
- 누비 색 빠짐·회복 연출

## 5. 제작 목록

| ID | 런타임 경로 | 형식·상태 | 용도 |
|---|---|---|---|
| W02-MAP-01 | `world/lake/lake-base.png` | DELIVERED final-v1, 3200×2400 불투명 PNG | 비반복 전체 배경 |
| W02-PROP-01 | `world/lake/props/wave-drum-idle.png` | DELIVERED, 1254×1254 투명 PNG | 반응 전 물결북 |
| W02-PROP-02 | `world/lake/props/wave-drum-active.png` | DELIVERED, 1254×1254 투명 PNG | 누비 접근 후 파문 발생 |
| W02-FX-01 | `world/lake/fx/wave-path.png` | DELIVERED, 2172×724 투명 PNG | 미로 방향 파문 |
| W02-MAP-02 | `world/lake/maze/reed-gate-closed.png` | DELIVERED v2, 투명 PNG | 미로 진입 또는 안전 물길 잠금 |
| W02-MAP-03 | `world/lake/maze/reed-gate-open.png` | DELIVERED v2, 투명 PNG | 구조 목표 이후 열린 상태 |
| W02-FX-02 | `world/lake/fx/current-flow.png` | DELIVERED v2, 투명 PNG | 물살 방향 표시 |
| W02-TRAP-01 | `world/lake/props/black-thread-trap.png` | DELIVERED v3, 투명 PNG | 검은 실 덫 |
| W02-NPC-01 | `world/lake/npcs/muldeuli.png` | 기존 자산 검수 후 재사용 | 안내 조연 물들이 |
| W02-ENEMY-01 | `sprites/enemies/wet-stitchling-idle.png` | DELIVERED v3, 4×128×128 | 젖은 실밥이 |
| W02-ENEMY-02 | `sprites/enemies/wet-sewn-doll-idle.png` | DELIVERED v3, 4×160×160 | 젖은 박음이 |
| W02-BOSS-01 | `sprites/bosses/waterlogged-sewn-doll-idle.png` | DELIVERED v4, 4×256×256 | 물먹은 박음이 기본 |
| W02-BOSS-02 | `sprites/bosses/waterlogged-sewn-doll-exposed.png` | DELIVERED v4, 4×256×256 | 검은 실 제거 뒤 약점 노출 |
| W02-AREA-01 | `world/lake/overlays/color-drained-zone.png` | DELIVERED v6, 투명 PNG | 색을 잃은 구역 |
| W02-AREA-02 | `world/lake/overlays/color-restored-zone.png` | DELIVERED v6, 투명 PNG | 복구된 구역 |
| W02-ITEM-01 | `items/relics/water-dye-yarn.png` | DELIVERED v4, 160×160 투명 PNG | 물빛 염색실 |
| W02-FX-03 | `fx/story/nubi-color-drain.png` | DELIVERED v5, 6×192×192 | 누비 위기 연출 |
| W02-FX-04 | `fx/story/nubi-color-restore.png` | DELIVERED v5, 6×192×192 | 유물 장착 회복 연출 |

## 6. 아트 방향

- 1장과 같은 포근한 뜨개질·펠트 미니어처 세계
- 물은 사진 같은 유체보다 얇은 오간자와 펠트가 겹친 재질로 표현
- 얕은 물은 파스텔 아쿠아, 깊은 물은 탁한 남청색으로 구분
- 굴절광은 크림·연보라·연분홍을 제한적으로 사용
- 물풀은 가는 뜨개 끈과 펠트 잎을 섞되 통로를 가리지 않음
- 검은 실은 적과 위험 요소에만 사용하며 면적을 작게 유지
- 염색 샘은 화면의 최종 초점이지만 종장 분위기나 신성 후광을 사용하지 않음

## 7. 금지

- 작은 타일 반복
- 맵을 여덟 개 하위 지역으로 분리
- 배경에 NPC·적·보상·잠금 상태를 고정
- 물 위에 화살표·글자·UI 기호 삽입
- 실사 물·플라스틱 광택·네온 청색
- 최종 에셋 승인 전 기능 좌표를 픽셀 단위로 반복 보정
- 누비의 최종 정체나 종장 외형을 암시하는 문양

## 8. 제작·연결 순서

1. 기능 맵에서 네 구역과 주 동선을 검증
2. `lake-base` 시안 1회 승인
3. 상태 오브젝트를 기능 우선순위에 맞춰 제작
4. Claude가 런타임 키와 서버 충돌 계약에 연결
5. `layout-qa`로 HUD·통로·목표 교차를 수치 검증
6. 1280×720·640×360 캡처 승인
7. 같은 에셋이 두 번 거절되면 좌표 보정을 멈추고 에셋 자체를 교체

