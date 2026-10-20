import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SpinGatherAppModule } from './spin-gather-app.module';

async function bootstrap() {
  const app = await NestFactory.create(SpinGatherAppModule);
  app.enableCors();
  const port = Number(process.env.SPIN_GATHER_PORT || 3006);
  await app.listen(port);
  console.log(`spin gather server listening on :${port}`);
}
bootstrap();
