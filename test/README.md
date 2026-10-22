# 게임별 회귀 테스트

게임 코드를 기준으로 `test/[게임code]`에 테스트를 둔다.

모든 게임 테스트를 끝까지 실행하고 실패한 게임의 오류만 출력한다.

각 게임은 로직 테스트와 함께 실제 FE 설정에 지정된 필수 BE로 HTTP 핑을 보낸다. 연결할 수 없으면 `서버 로딩 실패`로 처리하며 나머지 게임 테스트는 계속 실행한다. 배포 서버를 직접 검사하려면 `ACCOUNT_TEST_SERVER_URL`, `MULTIPLAYER_TEST_SERVER_URL`, `TURBY_TEST_SERVER_URL`, `KIRBY_TEST_SERVER_URL`, `MY_ROOM_DUNGEON_TEST_SERVER_URL`, `SWEET_SHOP_TEST_SERVER_URL`, `SPIN_GATHER_TEST_SERVER_URL` 환경변수를 지정한다.

```powershell
npm run test:all

# 오타를 포함한 요청 명령도 동일하게 지원
npm run tet:all
```

```powershell
npm run test:my-room-dungeon
npm run test:sweet-shop
npm run test:merge-defense
npm run test:number-hero-tower
npm run test:number-gate-runner

# 위 순서대로 전체 테스트
npm run test:release-games

# 전체 테스트 후 관련 FE 프로덕션 빌드
npm run verify:release-games
```
