import { Module } from '@nestjs/common';
import { KirbyModule } from './kirby/kirby.module';

// 커비 훔치기 전용 Nest 모듈 — 9번 작업순서 4단계(침입/실시간 추격·타격) 구현.
@Module({
  imports: [KirbyModule],
})
export class KirbyAppModule {}
