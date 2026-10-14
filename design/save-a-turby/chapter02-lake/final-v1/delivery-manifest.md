# 터비 구하기 2장 — 최종 호수 배경 전달 v1

작성일: 2026-10-14  
상태: C2-7A 런타임 연결·정합성 검수 준비 완료  
제작: Codex built-in image generation + 고품질 3200×2400 리사이즈 + PNG 팔레트 최적화

## 전달 파일

| ID | 파일 | 규격 | 용량 | SHA-256 |
|---|---|---:|---:|---|
| W02-MAP-01 | `lake-base.png` | 3200×2400, 불투명 PNG | 3,179,368 bytes | `357342612CE77CE7E0E90FCF9EF96035221B3AFF34F754CC8F8FA4E8C215FE12` |

## 구역 구성

- 좌하단: 숲 연결 입구와 넓은 안전 진입로
- 좌중단: 천막이 있는 호숫가 정착지와 빈 원형 안전 공터
- 중앙~우중단: 물풀 섬과 얕은 물길이 이어지는 미로
- 우상단: 중심이 열린 원형 염색 샘 전투 공터
- 밝은 아쿠아 얕은 물과 어두운 남청색 깊은 물을 명도·채도로 구분

## 런타임 계약

- 월드 원점 `(0,0)`, 표시 크기 3200×2400, 회전·반복·타일링 없음
- 배경에 캐릭터·적·보상·물결북·문·덫·목표 표식·UI가 포함되지 않음
- 진행 상태 오브젝트와 효과는 기존 투명 PNG를 위에 표시
- 이미지 색이나 알파를 충돌 판정에 사용하지 않음
- C2-7A에서는 기존 기능 좌표·충돌을 바꾸지 않고 배경만 연결해 정합성을 먼저 측정

## 아트 방향

- 털실·펠트·자수·오간자 소재의 몽실한 미니어처 세계
- 파스텔 아쿠아·민트·크림·연보라·연분홍
- 사진 같은 물, 네온 청색, 공포 분위기, 신성 후광 없음
- 작은 타일 반복 없이 한 장짜리 연속 배경

## 최종 생성 프롬프트 요약

```text
Near-orthographic top-down 4:3 handcrafted aquarium lake map for Save a Turby. One continuous pale stitched path connects lower-left entrance, left-center settlement, central-right reed maze and upper-right circular dye spring arena. Pastel felt, yarn, embroidery and organza; clear shallow/deep water; open spaces for runtime entities. No characters, enemies, items, drum, gates, traps, arrows, text, UI, boss or baked interactive objects. One non-repeating background.
```

