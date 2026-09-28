import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';

// 허브 도감(2026-09-28) — 허브가 계정·스코어보드 API와 같은 서버(커비 서버)로 호출한다.
@Module({
  controllers: [CollectionController],
  providers: [PrismaService, CollectionService],
})
export class CollectionModule {}
