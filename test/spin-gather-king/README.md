# 빙글 채집왕 테스트

저장 데이터의 기본값, 정규화, 구버전 호환, 해금 조건, 로컬 저장 복구를 검증한다.

```powershell
# 테스트만 실행
npm run test:spin-gather-king

# 테스트 후 게임 프로덕션 빌드까지 검증
npm run verify:spin-gather-king
```

테스트 파일은 게임 소스와 분리하여 저장소 루트의 `test/spin-gather-king` 아래에 둔다.
