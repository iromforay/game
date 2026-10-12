import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MyRoomDungeonAppModule } from './my-room-dungeon-app.module';

async function bootstrap() {
  const app = await NestFactory.create(MyRoomDungeonAppModule);
  app.enableCors();

  const port = process.env.MY_ROOM_DUNGEON_PORT
    ? Number(process.env.MY_ROOM_DUNGEON_PORT)
    : 3004;
  await app.listen(port);
  console.log(`my room dungeon server listening on :${port}`);
}

bootstrap();
