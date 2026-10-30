import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  if (process.env.USE_REDIS_ADAPTER === 'true') {
    const redisAdapter = new RedisIoAdapter(app);
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  console.log(`main server (rooms + my-room-dungeon + spin-gather) listening on :${port}${process.env.USE_REDIS_ADAPTER === 'true' ? ' (redis adapter enabled)' : ''}`);
}

bootstrap();
