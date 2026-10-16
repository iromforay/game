# 터비 구하기 2장 에셋 전달 v3 — 물풀 미로 위험 요소

작성일: 2026-10-13  
상태: C2-3 연결 준비 완료  
도구: Codex built-in image generation, 무손실 알파 유지 리사이즈

## 전달 파일

| ID | 파일 | 규격 | SHA-256 |
|---|---|---:|---|
| W02-TRAP-01 | `world/lake/props/black-thread-trap.png` | 1536×1024 ARGB | `CF74F54E004684662854AC37AF45D9C5BD2B749C3587273C3D196AE42CD483D4` |
| W02-ENEMY-01 | `sprites/enemies/wet-stitchling-idle.png` | 512×128 ARGB, 4×128×128 | `AE1FC37D4A1FF3B90EF4F49D2E8A97999E3CBAA2B699BC4236D9860E77E9279B` |
| W02-ENEMY-02 | `sprites/enemies/wet-sewn-doll-idle.png` | 640×160 ARGB, 4×160×160 | `F15B5BC7E4A54E2C06A7564510906B0DE70E02F3FEB95538968E1CDB15CE1C48` |

## 검은 실 덫 사용 계약

- 얕은 물에 배치하는 발목 속박 위험 요소다.
- 권장 월드 표시 크기: `92~128px × 62~86px`.
- 실제 발동 반경과 속박 판정은 서버 데이터가 소유한다.
- 플레이어보다 낮은 depth, 물살 오버레이보다 높은 depth에 둔다.
- 발동 전에는 전체 타원 고리가 보이고, 발동 후 상태는 C2-3에서 코드 연출 또는 별도 상태 에셋으로 결정한다.
- 피·가시·금속 덫처럼 표현하지 않는다.

## 젖은 실밥이 사용 계약

- 프레임 규격: 가로 4프레임, 각 `128×128`.
- 순서: idle 1 → idle 2 → idle 3 → idle 4.
- 권장 재생: `5~7fps`, 반복.
- 프레임마다 같은 바닥 중심과 캐릭터 크기를 유지한다.
- 호수 일반 적의 기본 표시 크기: `96~112px`.
- 원본은 정면에 가까운 3/4 시점이다. 맵에서는 좌우 이동 시 수평 반전을 허용한다.
- 검은 중심 실을 끊으면 풀어지는 판정과 애니메이션은 C2-3 개발 계약에서 정한다.

## 젖은 박음이 사용 계약

- 프레임 규격: 가로 4프레임, 각 `160×160`.
- 권장 재생: `4~6fps`, 반복.
- 호수 순찰 보조 적이며 젖은 실밥이보다 화면상 `1.2~1.35배` 크게 표시한다.
- 물 위에 검은 실 덫을 놓는 역할과 색을 잃은 구역에서 회복하는 역할을 사용한다.
- 단추눈과 축축한 천 인형 외형을 유지하며 공포 인형 연출을 사용하지 않는다.

## 시각 검수 기준

- 640×360에서 눈, 젖은 고리, 몸 윤곽을 식별할 수 있다.
- 덫과 적을 같은 위치에 겹쳐도 각각의 실루엣이 구분된다.
- 검은 면적이 주변 파스텔 배경을 넓게 덮지 않는다.
- 적이 무섭거나 공격적인 생물보다 젖어서 무거워진 실뭉치로 읽힌다.
- 이미지 알파를 충돌 판정으로 사용하지 않는다.

## 최종 생성 프롬프트 요약

```text
Black thread trap: compact oval loop of charcoal sewing thread with crossed strands, three stitched anchor knots and a few pastel aqua felt bubbles. Cozy handcrafted top-down game prop, child-friendly, transparent background, no metal, teeth, spikes, text or UI.

Wet Stitchling: four consistent horizontal idle frames of one cute dark navy wet yarn creature, wrapped in soaked teal loops, floppy yarn arms and pale lavender button-like eyes. Handcrafted felt and yarn sprite, transparent background, no horror, blood, teeth, claws, text or dividers.

Wet Sewn Doll: four consistent horizontal idle frames of one small soaked pastel felt patrol doll, wrapped in dark navy sewing cords, with pale button eyes and lavender stitches. Child-friendly handcrafted sprite, transparent background, no horror, weapons, text or dividers.
```

