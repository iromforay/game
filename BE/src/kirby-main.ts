import 'reflect-metadata';
import { join } from 'path';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

// 실행한 셸의 현재 디렉터리와 무관하게 항상 BE/.env를 읽는다. 비어 있는 상속 환경변수는
// dotenv가 덮어쓰지 않으므로 제거하되, 실제 값이 주입된 운영 환경변수는 우선한다.
for (const name of ['HUB_JWT_SECRET', 'HUB_INTERNAL_API_KEY', 'HUB_COOKIE_DOMAIN', 'HUB_CORS_ORIGINS']) {
  if (process.env[name] === '') delete process.env[name];
}
config({ path: join(__dirname, '..', '.env') });

// 알까기(main.ts)/터비(turby-main.ts)와 같은 레포/의존성을 공유하되, 별도 엔트리로 별도 PM2
// 프로세스로 기동(docs/Steal a Kirby.md 7번 확정 — save-a-turby 패턴 그대로 재사용).
async function bootstrap() {
  // AccountService의 모듈 상수도 위 환경 설정 이후 계산되게 동적으로 불러온다.
  const { KirbyAppModule } = await import('./kirby-app.module');
  const app = await NestFactory.create<NestExpressApplication>(KirbyAppModule);
  const allowedOrigins = (process.env.HUB_CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true });

  // 캐릭터/등급/무기 소개 정적 페이지 — 게임 로직과 무관해 순수 HTML/CSS/JS로 별도 제공(/guide)
  app.useStaticAssets(join(__dirname, '..', 'public', 'kirby-guide'), { prefix: '/guide' });

  const port = process.env.KIRBY_PORT ? Number(process.env.KIRBY_PORT) : 3003;
  await app.listen(port);
  const jwtSecretReady = Buffer.byteLength(process.env.HUB_JWT_SECRET ?? '', 'utf8') >= 32;
  console.log(`kirby server listening on :${port} (hub SSO HS256: ${jwtSecretReady ? 'configured' : 'missing key'})`);
}

bootstrap();
