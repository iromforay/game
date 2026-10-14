# 터비 구하기 2장 에셋 전달 v4 — 보스와 물빛 염색실

작성일: 2026-10-13  
상태: C2-5·C2-6 연결 준비 완료  
도구: Codex built-in image generation, 알파 유지 프레임 정규화

## 전달 파일

| ID | 파일 | 규격 | SHA-256 |
|---|---|---:|---|
| W02-BOSS-01 | `sprites/bosses/waterlogged-sewn-doll-idle.png` | 1024×256 ARGB, 4×256×256 | `DDA956CB4A6EBB1736C7A8D2AD6B2C80E77725AAEEE7CCB138A8AA0407005124` |
| W02-BOSS-02 | `sprites/bosses/waterlogged-sewn-doll-exposed.png` | 1024×256 ARGB, 4×256×256 | `44A8A76B5C48511ED101CE3449308E3E931504B626AE5D0BF9318AADF43D09D4` |
| W02-ITEM-01 | `items/relics/water-dye-yarn.png` | 160×160 ARGB | `EFA8EAD2B45AC1F1CF3EFB9100CA30F04EF6E96A1EBA7070A8ADFDE7D706081F` |

## 보스 상태 계약

- 두 시트는 각각 가로 4프레임이며 프레임당 `256×256`이다.
- 기본 상태는 굵은 검은 재봉실이 몸통과 팔을 묶고 중심을 가린다.
- 약점 노출 상태는 굵은 결박이 제거되고 가슴의 물빛 염색실 중심이 보인다.
- 약점 노출을 상처나 열린 몸으로 표현하지 않는다.
- 기본→노출 교체 시 같은 프레임 인덱스와 표시 중심을 유지한다.
- 권장 idle 재생: `3~5fps`.
- 권장 전투 표시 크기: `220~280px`.
- 서버 전투 상태가 표시 상태를 결정하며 이미지의 밝기나 알파를 판정 근거로 쓰지 않는다.

## 물빛 염색실 계약

- 이야기 유물 코드와 인벤토리 아이콘에 사용하는 `160×160` 정사각형 PNG다.
- 최초 승리 보상으로 한 번만 지급하며 확률 드롭으로 사용하지 않는다.
- 누비의 `story_2` 장착 슬롯과 연결한다.
- 평범한 털실 공보다 물결처럼 말린 끝과 염색된 아쿠아 색으로 식별한다.
- 태초의 실타래 최종 형태, 왕관, 성스러운 문양을 추가하지 않는다.

## 시각 검수 기준

- 기본 상태에서 결박 실과 몸 윤곽이 구분된다.
- 노출 상태에서 가슴 중심이 보이되 네온 섬광으로 몸 전체를 덮지 않는다.
- 640×360 전투 HUD에서 보스가 목표·버튼·참가자 칩을 가리지 않는다.
- 물빛 염색실은 80×80 표시에서도 털실과 물결형 끝을 식별할 수 있다.
- 상태 전환 시 보스 중심 위치 차이는 화면상 8px 이내다.

## 최종 생성 프롬프트 요약

```text
Waterlogged Sewn Doll: four consistent horizontal idle frames of one large child-friendly boss made from soaked teal felt scraps, knitted lake reeds and lavender stitches. Thick charcoal sewing-thread bindings cover the torso and arms; a subtle aqua center glow remains hidden. Transparent background, no horror, blood, weapons, text or dividers.

Exposed state: preserve the same four poses and exact boss identity; remove the removable dark bindings and reveal a compact softly glowing aqua yarn core at the chest, with no wound or cavity.

Water-Dye Yarn: one compact elegant pastel aqua yarn skein with a gentle water-ripple curl, lavender stitches and cream highlights. Cozy handcrafted transparent inventory icon, no crown, rune, halo, black thread, text or UI frame.
```

