# 2장 어항 속 호수 — 에셋 전달 v1

작성일: 2026-10-13  
상태: DELIVERED  
범위: C2-1 물결북 두 상태와 미로 방향 파문

| ID | 파일 | 원본 크기 | 런타임 키 | 월드 표시 권장값 | SHA-256 |
|---|---|---:|---|---|---|
| W02-PROP-01 | `world/lake/props/wave-drum-idle.png` | 1254×1254 ARGB | `wave-drum-idle` | 160×160, pivot `(0.5, 0.78)` | `1C8895C54850A74D7274FAA78FF201CE51580D4A6D677CC6EE4CDEB277D7EDF8` |
| W02-PROP-02 | `world/lake/props/wave-drum-active.png` | 1254×1254 ARGB | `wave-drum-active` | 160×160, pivot `(0.5, 0.78)` | `C8DC4047CFC4D08C837BE104BDB1585B21220E6CEAFE0E8461661AFCEFD9B409` |
| W02-FX-01 | `world/lake/fx/wave-path.png` | 2172×724 ARGB | `wave-path` | 480×160, pivot `(0.08, 0.5)` | `53F590AAD082A53D12E90749ABB4AB1C4895AF6FE5727EC448AD8F44B15ECD84` |

## 연결 규칙

- 원본 비율을 유지하며 찌그러뜨리지 않는다.
- 같은 좌표와 피벗에서 텍스처만 교체한다.
- `CH02_SETTLEMENT_MET` 전에는 idle, 물결북 반응이 시작되면 active를 사용한다.
- active 효과는 이야기 진행 표시이며 충돌 크기를 키우지 않는다.
- 상호작용 반경과 충돌은 이미지의 빛 고리가 아니라 북 본체를 기준으로 한다.
- 모바일에서 active 빛 고리가 HUD와 교차하지 않아야 한다.
- 두 상태 전환 후에도 물결북은 아이템으로 지급되지 않는다.
- `wave-path`는 active 전환과 함께 나타나며 미로 방향으로 회전·배치할 수 있다.
- `wave-path`는 안내 효과일 뿐 충돌·상호작용·체크포인트 판정에 사용하지 않는다.
- 파문 아래의 길과 캐릭터가 식별되도록 월드 표시 알파는 0.72 이하에서 시작한다.

## 검수

- 세 파일 모두 실제 알파 채널이 있는 투명 PNG다.
- 배경·텍스트·UI·캐릭터가 포함되지 않는다.
- 본체의 카메라 각도와 중심 배치는 동일하다.
- active는 본체를 유지하고 파문·광점만 추가한 상태다.
- `wave-path`에는 화살표·문자·바닥 이미지가 포함되지 않는다.

