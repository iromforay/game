module.exports = {
  apps: [
    {
      name: 'be',
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // 터비 구하기(Save a Turby) 전용 프로세스 — 같은 레포/빌드 산출물, 별도 엔트리
      // (docs/Save a Turby.md 3.5.3 최종 확정)
      name: 'turby-be',
      cwd: __dirname,
      script: 'dist/turby-main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // 커비 훔치기(Steal a Kirby) 전용 프로세스 — 같은 레포/빌드 산출물, 별도 엔트리
      // (docs/Steal a Kirby.md 7번 확정 — save-a-turby와 동일 패턴)
      name: 'kirby-be',
      cwd: __dirname,
      script: 'dist/kirby-main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        KIRBY_PORT: process.env.KIRBY_PORT || 3003,
      },
    },
    {
      // 내 방이 던전 전용 저장 API 프로세스
      name: 'my-room-dungeon-be',
      cwd: __dirname,
      script: 'dist/my-room-dungeon-main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        MY_ROOM_DUNGEON_PORT: process.env.MY_ROOM_DUNGEON_PORT || 3004,
      },
    },
    {
      // 달콤상점 전용 API·Socket.IO 프로세스
      name: 'sweet-shop-be',
      cwd: __dirname,
      script: 'dist/sweet-shop-main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        SWEET_SHOP_PORT: process.env.SWEET_SHOP_PORT || 3005,
        SWEET_SHOP_MULTIPLAYER_ENABLED: process.env.SWEET_SHOP_MULTIPLAYER_ENABLED || 'true',
      },
    },
  ],
};
