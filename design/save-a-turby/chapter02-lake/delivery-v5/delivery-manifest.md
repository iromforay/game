# 터비 구하기 2장 에셋 전달 v5 — 누비 색 빠짐·회복 효과

작성일: 2026-10-13  
상태: C2-4·C2-6 연결 준비 완료  
도구: Codex built-in image generation, 알파 유지 프레임 정규화

## 전달 파일

| ID | 파일 | 규격 | SHA-256 |
|---|---|---:|---|
| W02-FX-03 | `fx/story/nubi-color-drain.png` | 1152×192 ARGB, 6×192×192 | `A91E82FA14727F710B5C336478662847FA814D61D941A7F964B9558F1187BD15` |
| W02-FX-04 | `fx/story/nubi-color-restore.png` | 1152×192 ARGB, 6×192×192 | `8F24BBB927F028D36240A5E00DE218655F9E4DD9F38CA99900A3D40A36947794` |

## 사용 계약

- 두 파일은 캐릭터를 포함하지 않는 투명 오버레이다.
- 각 파일은 가로 6프레임이며 프레임당 `192×192`다.
- 누비의 화면 중심에 같은 피벗으로 겹쳐 사용한다.
- 색 빠짐: 1→6 순서로 재생하며 따뜻한 실색이 물결 방향으로 빠져나가고 옅은 회청색 테두리가 남는다.
- 색 회복: 1→6 순서로 재생하며 같은 흐름을 역순으로 사용해 색이 돌아오는 느낌을 낸다.
- 권장 재생: `8~10fps`, 1회 재생.
- 위기 장면은 실패가 아니므로 체력 감소·실패 UI·붉은 화면을 함께 사용하지 않는다.
- 회복 효과는 물빛 염색실 장착 성공 뒤에만 재생한다.

## 시각 검수 기준

- 각 프레임 중앙은 누비 얼굴과 몸을 볼 수 있도록 투명하다.
- 효과가 대화창의 이름·본문을 가리지 않는다.
- 640×360에서 화면 전체 섬광이나 흰색 번쩍임으로 보이지 않는다.
- 색 빠짐과 회복을 같은 방향으로 재생하지 않는다.
- 누비의 최종 정체나 종장 외형을 암시하는 문양이 없다.

## 최종 생성 프롬프트 요약

```text
Six sequential transparent overlay frames showing pastel peach, cream, aqua and lavender yarn fibers gently pulled from an empty round Nubi-sized center by lake water, ending in a pale grey-blue rim. Effects only, no character. Cozy yarn and organza VFX, child-friendly, no pain, smoke, explosion, text, UI or background.

The restore sheet uses the same normalized frames in reverse order so the fibers and color return to Nubi without changing character identity.
```

