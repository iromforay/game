# 터비 구하기 2장 에셋 전달 v2 — 물살 오버레이

작성일: 2026-10-13  
상태: C2-2 연결 준비 완료  
도구: Codex built-in image generation

## 전달 파일

| ID | 파일 | 원본 크기 | 알파 | SHA-256 |
|---|---|---:|---|---|
| W02-FX-02 | `world/lake/fx/current-flow.png` | 2172×724 | ARGB | `630254B299E4DE195FAAE27454BD7708F40F8C43FDBB657D9C9FA67DA25B5FE7` |
| W02-MAP-02 | `world/lake/maze/reed-gate-closed.png` | 1536×1024 | ARGB | `E11FCC9F4932D8154E9359D9E3C3DA29DDD27CB501F9F78F0AAACBE06BDBDB4D` |
| W02-MAP-03 | `world/lake/maze/reed-gate-open.png` | 1536×1024 | ARGB | `BE6113921894C78CCFC28F634C7F9F788BFC27546797D981B19B346AC39E4840` |

## 사용 계약

- 물풀 미로의 물살 방향을 보여 주는 투명 월드 오버레이다.
- 화살표·문자·UI가 없는 곡선 결로 방향을 전달한다.
- 원본 전체를 한 화면 크기로 표시하지 않는다. 각 물살 구역에 맞게 잘라 쓰거나 균일 축소한다.
- 가로세로 비율을 유지한다.
- 권장 월드 표시 폭은 약한 물살 `320~460px`, 강한 물살 `460~620px`다.
- 표시 불투명도는 배경 위 `0.48~0.68` 범위에서 조정한다.
- 플레이어, NPC, 상호작용 버튼보다 낮은 depth에 둔다.
- 방향 반전이 필요하면 수평 뒤집기를 허용한다. 자유 회전은 허용하지만 비균일 변형은 금지한다.
- 이 이미지는 충돌·서버 판정의 근거가 아니다. 물살 영역과 방향은 서버 지역 데이터가 소유한다.

### 물풀 장벽

- closed와 open은 같은 중심·피벗·표시 상자를 사용한다.
- 권장 월드 표시 크기: 폭 `220~300px`, 높이 `150~200px`.
- closed는 통로를 완전히 막으며 서버 gate가 닫힌 동안 표시한다.
- open은 중앙 투명 통로가 전체 폭의 약 45% 이상이며 서버 gate가 열린 뒤 표시한다.
- 두 상태의 충돌 여부는 서버 gate 사건이 결정한다. 이미지 알파를 충돌 마스크로 쓰지 않는다.
- 상태 전환 시 위치가 튀지 않도록 같은 표시 크기로 교체한다.

## 시각 검수 기준

- 정지 화면에서도 흐름 방향을 읽을 수 있다.
- 640×360에서 플레이어 실루엣을 완전히 가리지 않는다.
- 물살 오버레이와 HUD·목표 문구 교차 0
- 반복 배치 경계가 보이면 같은 이미지를 연속 타일링하지 말고 구역별 단일 배치로 사용한다.
- 네온 청색, 실사 물, 화살표로 보이지 않아야 한다.
- 열린 장벽 중앙의 알파는 0이어야 하며 이동 통로를 시각적으로 가리지 않는다.
- 닫힘·열림 전환 때 양쪽 기둥의 중심 위치 차이는 화면상 8px 이내여야 한다.

## 최종 생성 프롬프트

```text
Use case: stylized-concept
Asset type: transparent 2D game world overlay for Save a Turby, Chapter 2 aquarium lake
Primary request: create a single seamless-looking curved water-current flow overlay that clearly shows water moving from left to right without using arrows, text, icons, or UI symbols
Scene/backdrop: transparent background only
Subject: several soft parallel curved stream ribbons, small felt bubbles, and gently swept yarn-like water fibers; wide horizontal composition with tapering ends; usable as an overlay above a pastel lake map
Style/medium: cozy handcrafted miniature game art, layered translucent organza, soft felt and fine knitted thread, painterly polished sprite asset
Composition/framing: very wide horizontal band, flow originates softly at left and bends slightly upward toward right, ample transparent margins, no hard rectangular edge
Lighting/mood: gentle luminous aquarium light, calm and readable for young children
Color palette: pastel aqua, pale turquoise, powder blue, tiny cream highlights, low contrast enough to blend into a map while remaining visible
Materials/textures: translucent fabric water, stitched curved strands, soft fuzzy edges kept clean
Constraints: genuine alpha transparency; no background; no land; no characters; no enemies; no objects; no words; no arrows; no watermark; no black; do not fill the entire canvas; retain clear negative space between flow strands
Avoid: photorealistic water, plastic gloss, neon blue, square tile boundaries, repeated tile pattern, sharp spikes
```

물풀 장벽은 built-in image generation으로 닫힘 상태를 만든 뒤 같은 이미지를 기준으로 열림 상태를 편집했다. 공통 프롬프트 요지는 다음과 같다.

```text
Cozy handcrafted knitted water-reed gate for a top-down aquarium lake map. Pastel teal, seafoam, aqua and pale mint yarn reeds with stitched felt leaves and a small amount of charcoal locking thread. Transparent background, no characters, no text, no arrows, no UI, no tile edge.

Closed: dense reeds and threads fully block the passage.
Open: preserve the same posts, colors, scale and camera; sweep the center reeds into tied bundles at both sides, leaving at least 45% of the width genuinely transparent and walkable.
```

