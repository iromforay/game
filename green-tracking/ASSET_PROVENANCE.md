# Green Tracking 에셋 출처

## `src/assets/forest-path-clean-v3.png` / `.webp`

- 분류: AI 생성 실사형 배경 이미지
- 생성일: 2026-10-26
- 생성 도구: Codex에서 제공된 OpenAI 이미지 생성 도구
- 외부 사진·스톡 사이트·웹 검색 사용: 없음
- 원본 생성 파일: `C:\Users\foray\.codex\generated_images\01a16662-cc5c-7d42-b81c-95995cfc7af5\exec-1a63be46-7f99-4851-9b36-4501c169a36e.png`
- 실제 게임 적용 파일: `src/assets/forest-path-clean-v3.webp`
- 구성 원칙: 가까운 나무·수양버들·갈대·큰 잡풀을 배경에서 제외하고, 오솔길·낮은 지피식물·먼 숲만 배치한다.
- 보행 연출: 나무·수양버들·갈대·잡풀은 투명 2.5D 오브젝트로만 사용하며 소실점에서 화면 가장자리 방향으로 이동한다.

## `src/assets/forest-path-backdrop-v2.png` / `.webp`

- 분류: AI 생성 실사형 배경 이미지
- 생성일: 2026-10-23
- 생성 도구: Codex에서 제공된 OpenAI 이미지 생성 도구
- 외부 사진·스톡 사이트·웹 검색 사용: 없음
- 원본 생성 파일: `C:\Users\foray\.codex\generated_images\01a16662-cc5c-7d42-b81c-95995cfc7af5\exec-bffc207c-8c87-48a1-991d-cab4e8b14b76.png`
- 실제 게임 적용 파일: `src/assets/forest-path-backdrop-v2.webp`
- 개선점: 흙길의 자갈·낙엽·습도감, 불규칙한 식생, 단일 광원과 자연스러운 원근을 강화하고 반복 식생을 제거
- 표시 방식: 배경 자체만 사용하며 별도의 나무·갈대·잡풀 오브젝트를 중첩하지 않는다.

## `src/assets/forest-path-backdrop.png`

- 분류: AI 생성 이미지
- 생성일: 2026-10-22
- 생성 도구: Codex에서 제공된 OpenAI 이미지 생성 도구
- 외부 사진·스톡 사이트·웹 검색 사용: 없음
- 원본 생성 파일: `C:\Users\foray\.codex\generated_images\01a1621d-6c24-7fa1-a6fc-3630d8359c7a\exec-e1c3bd4f-2701-4912-800a-0c153de74f2a.png`
- 프로젝트 사용 파일: `src/assets/forest-path-backdrop.png`
- 용도: 3D 숲길 MVP의 먼 배경 텍스처
- 원본 PNG SHA-256: `9ED41CC015926D32294A6981B0A2DB56E11B07A37597A43C48872E4922DA9DF2`
- 원본 PNG 바이너리 확인 문자열: `c2pa`, `jumbf`, `OpenAI`, `trainedAlgorithmicMedia`, `xmp`
- 서비스용 WebP 원본: `openai-generated-forest-path.webp`
- 실제 게임 적용 파일: `src/assets/forest-path-backdrop.webp`
- WebP SHA-256: `A82E0DA05ACC737381E93677287E619773DC736BE204607AF878B27A9E9FCA4E`
- WebP 변환: 2026-10-22, 원본 PNG를 Chrome Canvas WebP 품질 0.92로 재인코딩. 증빙 원본이 아님.

### 생성 프롬프트

```text
Use case: photorealistic-natural
Asset type: distant background texture for a browser-based 3D walking-scene MVP
Primary request: a clean, high-resolution photorealistic Korean riverside forest path in late spring, viewed straight ahead at adult eye level; the narrow earthen walking path continues toward a centered distant vanishing point through lush green vegetation
Scene/backdrop: dense but calming woodland, soft distant willow silhouettes, layered green foliage, pale blue sky glimpsed through leaves, faint humid atmospheric depth
Style/medium: premium natural landscape photography, realistic botanical detail, not illustration, not game concept art
Composition/framing: wide landscape, centered horizon and vanishing point, distant scenery only; keep the closest foreground relatively simple because real-time 3D plants will be placed over it
Lighting/mood: soft bright overcast daylight, restful and eye-comforting, no harsh contrast
Color palette: natural fresh greens, muted blue-green shadows, restrained saturation
Constraints: no people, no buildings, no signs, no text, no watermark, no animals, no fantasy elements; consistent forward-facing perspective suitable as a distant 3D backdrop
Avoid: oversaturated HDR, painterly style, blurry low-resolution foliage, dramatic sun rays, fisheye distortion
```

## 실사형 2.5D 식생 에셋

아래 파일은 모두 2026-10-22 Codex에서 제공된 OpenAI 이미지 생성 도구로 새로 생성한 투명 PNG다. 외부 사진·스톡 사이트·웹 검색은 사용하지 않았다. 게임에서는 두 장의 평면을 미세하게 교차한 2.5D 카드로 배치한다.

| 프로젝트 파일 | 용도 | 생성 원본 |
| --- | --- | --- |
| `src/assets/photoreal-willow.png` | 오래된 수양버들 | `exec-50ea3b02-cd1a-4066-a684-28033ebef67f.png` |
| `src/assets/photoreal-deciduous-tree.png` | 일반 활엽수 | `exec-17c8c75b-8a10-41d7-bff2-2dbc8e587732.png` |
| `src/assets/photoreal-reeds.png` | 갈대·부들 군락 | `exec-2678bd86-71ed-4c20-9394-6129e2d1530a.png` |
| `src/assets/photoreal-wild-grass.png` | 숲길 잡풀 군락 | `exec-5fce6658-fe74-4c4d-ac55-e7e4a3dcddd6.png` |

생성 원본 보관 경로: `C:\Users\foray\.codex\generated_images\01a1621d-6c24-7fa1-a6fc-3630d8359c7a`

## `openai-generated-golden-carp-stream.png`

- 분류: AI 생성 이미지
- 생성일: 2026-10-22
- 생성 도구: Codex에서 제공된 OpenAI 이미지 생성 도구
- 외부 사진·스톡 사이트·웹 검색 사용: 없음
- 원본 생성 파일: `C:\Users\foray\.codex\generated_images\01a1621d-6c24-7fa1-a6fc-3630d8359c7a\exec-50e85d2e-67d5-4e8a-8d77-a4ca2bc09715.png`
- 프로젝트 사용 파일: `openai-generated-golden-carp-stream.png`
- 내용: 숲길 앞 작은 냇가, 돌다리, 황금잉어 무리, 도약하는 황금잉어 한 마리, 부레옥잠
- 원본 PNG SHA-256: `5E53DD9261503FE7471A0F639793F334B0267763505EC87E2F28B31253521744`
- 원본 PNG 바이너리 확인 문자열: `c2pa`, `jumbf`, `OpenAI`, `trainedAlgorithmicMedia`, `xmp`

## 배포 전 확인

- 실제 서비스에 포함할 모든 외부 에셋은 파일별 출처와 사용 허가를 이 문서에 기록한다.
- 출처 또는 사용 허가를 확인할 수 없는 에셋은 배포본에서 제외한다.
- AI 생성 에셋의 상업적 사용 조건은 배포 시점의 적용 약관과 프로젝트 정책을 별도로 확인한다.
- C2PA가 들어 있는 원본 PNG를 증빙 원본으로 보존한다. WebP 변환본은 메타데이터가 제거될 수 있으므로 증빙 원본으로 사용하지 않는다.
