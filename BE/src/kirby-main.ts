import 'dotenv/config';
import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { KirbyAppModule } from './kirby-app.module';

// 알까기(main.ts)/터비(turby-main.ts)와 같은 레포/의존성을 공유하되, 별도 엔트리로 별도 PM2
// 프로세스로 기동(docs/Steal a Kirby.md 7번 확정 — save-a-turby 패턴 그대로 재사용).
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(KirbyAppModule);
  app.enableCors();

  // 캐릭터/등급/무기 소개 정적 페이지 — 게임 로직과 무관해 순수 HTML/CSS/JS로 별도 제공(/guide)
  app.useStaticAssets(join(__dirname, '..', 'public', 'kirby-guide'), { prefix: '/guide' });

  const port = process.env.KIRBY_PORT ? Number(process.env.KIRBY_PORT) : 3003;
  await app.listen(port);
  console.log(`kirby server listening on :${port}`);
}

bootstrap();
