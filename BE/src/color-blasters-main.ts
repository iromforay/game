import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ColorBlastersAppModule } from './color-blasters-app.module';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(ColorBlastersAppModule);
  app.enableCors();

  if (process.env.USE_REDIS_ADAPTER === 'true') {
    const redisAdapter = new RedisIoAdapter(app);
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
  }

  const port = Number(process.env.COLOR_BLASTERS_PORT || 3007);
  await app.listen(port);
  console.log(`color blasters server listening on :${port}${process.env.USE_REDIS_ADAPTER === 'true' ? ' (redis adapter enabled)' : ''}`);
}

bootstrap();
