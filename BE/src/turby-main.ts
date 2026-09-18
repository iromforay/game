import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { TurbyAppModule } from './turby-app.module';

// 알까기(main.ts)와 같은 레포/의존성을 공유하되, 별도 엔트리로 별도 PM2 프로세스로 기동
// (docs/Save a Turby.md 3.5.3 최종 확정 — 재배포 시 서로 영향 없도록 분리)
async function bootstrap() {
  const app = await NestFactory.create(TurbyAppModule);
  app.enableCors();

  const port = process.env.TURBY_PORT ? Number(process.env.TURBY_PORT) : 3002;
  await app.listen(port);
  console.log(`turby server listening on :${port}`);
}

bootstrap();
