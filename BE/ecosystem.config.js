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
        KIRBY_PORT: 3003,
      },
    },
  ],
};
