# Green Tracking 원본 음원 관리

이 폴더는 편집 전 WAV·FLAC 원본을 로컬에서 보관한다. 원본 바이너리는 용량 때문에 Git에 올리지 않으며, 이 문서와 `../../../../AUDIO_PROVENANCE.md`로 사용 이력을 추적한다.

## 원본 목록

| 분류 | 원본 파일 | 용도 | 길이 | 채널 | 원본 음질 | 라이선스 | 사용 상태 |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| ambience | `869861__kvgarlic__late-summer-wind-leaves-september-6-2026.wav` | 활엽수 사이 바람과 나뭇잎 환경음 | 03:51.17 | Stereo | 96.096 kHz · 24-bit | CC0 | 사용 |
| birds | `454024__kyles__forest-backyard-residential-winter-birds-chickadees-distant-skyline.flac` | 먼 숲의 새소리 01 | 04:10.58 | Stereo | 48 kHz · 24-bit | CC0 | 사용 |
| birds | `47989__luftrum__forestsurroundings.wav` | 먼 숲의 새소리 02 | 03:02.35 | Stereo | 44.1 kHz · 16-bit | CC BY 4.0 | 사용·크레딧 필수 |
| footsteps/grass | `521587__fission9__hiking-boot-footsteps-on-grass.wav` | 풀밭 등산화 발걸음 6종 | 00:04.35 | Mono | 48 kHz · 24-bit | CC0 | 사용 |
| footsteps/grass | `488074__bendrain__footsteps_grass_single_03.wav` | 풀밭 단일 발걸음 1종 | 00:00.92 | Stereo | 48 kHz · 24-bit | CC0 | 사용 |

## 게임용 파생 파일

```text
../runtime/
├─ ambience/forest-wind-loop.ogg
├─ birds/birds-distant-01.ogg
├─ birds/birds-distant-02.ogg
└─ footsteps/grass/grass-step-01.ogg ~ grass-step-07.ogg
```

- 바람: 원본의 60~126초 구간을 사용해 6초 크로스페이드가 적용된 60초 루프로 제작
- 새소리 01: 원본 52초 지점부터 14초 추출
- 새소리 02: 원본 88초 지점부터 14초 추출
- 발소리 01~06: 4.35초 원본의 무음 경계를 분석해 여섯 걸음으로 분리
- 발소리 07: 단일 발걸음 원본을 0.86초로 정리
- 발소리 공통 보정: 금속성 타격음을 줄이기 위해 3 kHz 이상 감쇄, 1.7 kHz 대역 추가 감쇄, 느린 어택 압축과 -26 LUFS 정규화 적용
- 런타임 공통 형식: OGG Vorbis · 48 kHz

## 원본 무결성 SHA-256

```text
869861...wav  E2293D2DDCD2F6B1C63283528FFED5C568283285353CDF49F85947A79D83DE52
454024...flac C5BDF000B3A6EF8DE91D01D179ABCA50E128776DC5C4D4ADA55815401320507A
47989...wav   FD823970F0724EAE9E76E22A466CD3DB59967EE1AF4D772909183F939090D890
521587...wav  04A6B96A01F2A43F0E72DAD1CC75BE4C92D46B095EA30E87C2EBCC201D538D92
488074...wav  5457874882FF9EECAC8AFDD14E1797037260DBB840BFD57049E2406FCC10E7BC
```

## 원본 추가 규칙

1. `ambience`, `birds`, `footsteps/<surface>` 중 맞는 폴더에 원본을 넣는다.
2. 이 표에 파일명, 용도, 메타데이터, 라이선스와 사용 상태를 기록한다.
3. Freesound ID와 제작자, 원본 URL은 `AUDIO_PROVENANCE.md`에 기록한다.
4. 원본을 편집하거나 덮어쓰지 않는다. 결과물은 항상 `../runtime/`에 별도 저장한다.
5. 원본이 바뀌면 SHA-256도 다시 기록한다.
