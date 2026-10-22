# 터비 구하기 3장 C3-4 2차 에셋 전달 manifest

제작일: 2026-10-16
제작 방식: OpenAI built-in image generation, 프레임 시트 규격화 및 알파 검증
런타임 연결 담당: Claude

## 전달 목록

| ID | 파일 | 원본 크기 | 알파 | 화면 표시·계약 | SHA-256 |
|---|---|---:|---|---|---|
| W03-ENM-01 | `pressed-sewn-doll-idle.png` | 640×160 | 투명 | 4×160, 약 120px, 4~6fps | `D091A246607FF78E19C2EC0D89848DA53FA6D9EB1A7B745C39E3A7614BA515BE` |
| W03-ENM-02 | `pressed-sewn-doll-exposed.png` | 640×160 | 투명 | 4×160, idle과 같은 중심 | `906B98A74F21F42E6858BF38012FB925155A2D6C77B659B88C4BF1934F2FF93E` |
| W03-ENM-03 | `small-spool-idle.png` | 512×128 | 투명 | 4×128, 약 100px, 5~7fps | `0396B7C1123C29743A56764409B8B2FD58BA8393F89B2168DE5347A3DB5D2265` |
| W03-ENM-04 | `carrier-thread.png` | 128×128 | 투명 | 약 80px | `5DB5116F2B0FA20CDB610282526B12021C8E8E90F4657F1FA30FD0FFAAB4A295` |
| W03-BOSS-01 | `memory-spool-idle.png` | 1024×256 | 투명 | 4×256, 220~280px, 3~5fps | `638694F6E4EF4AC1CDAABEA846AB9FC42440D1CB89EEC47C67B3CDB0AE3AF027` |
| W03-BOSS-02 | `memory-spool-exposed.png` | 1024×256 | 투명 | 4×256, idle과 중심 차이 8px 이내 | `693562AA9C0C9D39B590CA291478676A3C3FB941A0C62EC15082343609F95642` |
| W03-BOSS-03 | `memory-thread.png` | 640×128 | 투명 | 5×128, 분홍·청록·금색·보라·산호 순서 | `5758F5B872D8F0BF698B144FA67BFE7DE09221E45E5039E96F420B1DD42F2255` |
| W03-BOSS-04 | `memory-thread-hint.png` | 128×128 | 투명 | 약 96px, 기억실 위에 중첩 | `AA75217E2B2E65F2C60E047DBBD9DF1C30BA11D3B93D5507D90E2A20813B2E30` |
| W03-ITEM-01 | `old-cotton-core.png` | 160×160 | 투명 | 인벤토리 80×80, 장면 160px | `A81810F36CDC94DC37EBB7C78FE8FC74B250270A27113F8D17867E07F8BFFBFB` |
| W03-MAP-04 | `ambush-pile.png` | 512×512 | 투명 | 120×120, 피벗 `(0.5,0.7)` | `60985A1555A7D7E902E2C8FFD309A70266E8886B9CC98B1C78837014557EEEB6` |
| W03-MAP-05 | `boss-entrance-mark.png` | 512×512 | 투명 | 120×120, 피벗 `(0.5,0.7)` | `3B5A4CFBCD938F639EAC9353A873A70AB5680CDB867872B7ABF282DB0A680E3D` |
| W03-OVL-02 | `boss-arena-overlay.png` | 1400×1200 | 투명 | 700×600, 왼쪽 위 `(2450,140)`, 알파 약 0.8 | `42D2AF04830B4D792D990F10F24134C2AEC96E6E621CEAEEDAFCFDBF2E9EBE05` |
| W03-FX-04 | `memory-fragment.png` | 768×768 | 투명 | 지름 약 320px | `89D1B4E1AF96D5D3D998C458E955A175A822CE1894DBDF9431BF8ADDA5885EDF` |
| W03-FX-05 | `silver-thread.png` | 768×768 | 투명 | 지름 약 320px | `416BC908A79C2BDAF86CCD5F5A01C8D74E3E91C5AC79F5FFCA8D389B360956E3` |

## 프레임 계약

- 모든 시트는 셀 경계 안에서 개별 프레임을 합성했으며 인접 프레임으로 번지는 픽셀이 없다.
- 눌린 박음이 2종은 같은 프레임 인덱스와 표시 중심을 사용한다. 납작 상태는 낮고 넓으며 노출 상태는 몸이 펴지고 검은 재봉선이 보인다.
- 기억 실패굴이 2종의 프레임별 알파 경계 중심 차이는 최대 6px다.
- 기억실 프레임 순서는 `1 분홍 / 2 청록 / 3 금색 / 4 보라 / 5 산호`로 고정한다.
- 애니메이션 프레임은 미세한 흔들림과 호흡만 표현하며 서버 상태 판정에는 사용하지 않는다.

## 연결 메모

- `old-cotton-core`는 `items/**`에서 파일명 기반 키 `old-cotton-core`로 연결한다.
- `memory-thread-hint`는 별도 상태 그림이며 기억실 자체의 프레임이나 색을 바꾸지 않고 위에 중첩한다.
- `boss-arena-overlay`는 중앙을 비우고 좌하단 입구를 열어 두었다. 배경에 700×600으로 표시할 때 별도 충돌을 만들지 않는다.
- `memory-fragment`에는 구체적인 방·인물·정체 단서를 넣지 않았다.
- `silver-thread`만 차가운 은빛과 얇은 서리를 사용한다.
