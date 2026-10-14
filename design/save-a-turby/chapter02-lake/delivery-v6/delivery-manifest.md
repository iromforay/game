# 터비 구하기 2장 에셋 전달 v6 — 색 상실·복구 구역

작성일: 2026-10-13  
상태: C2-5 보스전 연결 준비 완료  
도구: Codex built-in image generation

## 전달 파일

| ID | 파일 | 규격 | SHA-256 |
|---|---|---:|---|
| W02-AREA-01 | `world/lake/overlays/color-drained-zone.png` | 1536×1024 ARGB | `E43DB1ED7C3B3842C6536E9CD6B089BDED456D0479E41C5335272D76E7276FD0` |
| W02-AREA-02 | `world/lake/overlays/color-restored-zone.png` | 1536×1024 ARGB | `D428764E9D80AECBA8502B9BBC0339D1490C7CC68CCB7ECAA1EB9C7B5E97FA9A` |

## 사용 계약

- 두 이미지는 같은 보스전 구역의 상태 변형이다.
- 같은 중심·피벗·표시 크기로 교체한다.
- 권장 월드 표시 크기: `620~760px × 410~510px`.
- 기본 전투 상태에는 color-drained를 표시한다.
- 해당 구역의 검은 재봉실 제거와 서버 복구 판정 뒤 color-restored로 교체한다.
- 캐릭터, 보스, 약점, 전리품보다 낮은 depth에 둔다.
- 알파 모양을 이동·전투 판정에 사용하지 않는다.

## 시각 검수 기준

- drained는 낮은 채도의 회청색과 가는 검은 실맥으로 식별한다.
- restored는 파스텔 아쿠아·민트·연보라가 돌아오되 네온이나 무지개로 보이지 않는다.
- 두 상태의 외곽 위치 차이는 화면상 12px 이내다.
- 중앙은 보스와 플레이어 실루엣을 읽을 수 있게 열어 둔다.
- 640×360에서 HUD·목표·행동 버튼과 교차하지 않도록 카메라·표시 크기를 조정한다.

## 최종 생성 프롬프트 요약

```text
Color-drained zone: a wide irregular top-down textile lake patch made from desaturated grey-blue organza, faded mint felt, washed-out stitched currents and subtle charcoal sewing-thread veins. Transparent feathered edge, open center, no characters, objects, text, arrows or hard tile boundary.

Color-restored zone: preserve the exact footprint and layer shapes; restore soft pastel aqua, turquoise, seafoam, lavender and cream stitched currents, replacing charcoal veins with harmless pale fibers. No neon, portal, sacred symbol or opaque plate.
```

