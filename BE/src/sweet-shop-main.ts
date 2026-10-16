import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SweetShopAppModule } from './sweet-shop-app.module';

async function bootstrap() {
  const app = await NestFactory.create(SweetShopAppModule);
  app.enableCors();

  const port = process.env.SWEET_SHOP_PORT
    ? Number(process.env.SWEET_SHOP_PORT)
    : 3005;

  await app.listen(port);
  console.log(`sweet shop server listening on :${port}`);
}

bootstrap();
