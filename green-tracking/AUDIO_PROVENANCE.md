# Green Tracking 오디오 출처

원본은 `src/assets/audio/source/`에 로컬 보관하며 Git에는 포함하지 않는다. 게임 배포본에는 편집한 OGG 파일만 포함한다.

| Freesound ID | 원본·제작자 | 라이선스 | 게임 내 사용 |
| --- | --- | --- | --- |
| [869861](https://freesound.org/s/869861/) | `Late summer wind leaves September 6 2026` · kvgarlic | CC0 | 60초 숲 바람 크로스페이드 루프 |
| [454024](https://freesound.org/s/454024/) | `Forest Backyard Residential Winter Birds...` · kyles | CC0 | 먼 새소리 01 |
| [47989](https://freesound.org/s/47989/) | `forestsurroundings.wav` · Luftrum | CC BY 4.0 | 먼 새소리 02 |
| [521587](https://freesound.org/s/521587/) | `Hiking Boot Footsteps on Grass` · Fission9 | CC0 | 풀 발소리 01~06 |
| [488074](https://freesound.org/s/488074/) | `Footsteps_Grass_Single_03.wav` · BenDrain | CC0 | 풀 발소리 07 |

## MVP 편집 사항

- 환경음: 48 kHz 스테레오 OGG, 60초, 6초 크로스페이드, -25 LUFS 기준 정규화
- 새소리: 48 kHz 스테레오 OGG, 각 14초, 페이드 인·아웃 및 -27 LUFS 기준 정규화
- 발소리: 48 kHz 모노 OGG, 7개 단발 샘플, 3 kHz 로우패스·1.7 kHz 감쇄·트랜지언트 압축·-26 LUFS 정규화
- 최초 편집일: 2026-10-26
- 발소리 음색 보정일: 2026-10-27

`forestsurroundings.wav`는 CC BY 4.0이므로 게임 크레딧에서 Luftrum과 원본 링크를 반드시 표시한다.
