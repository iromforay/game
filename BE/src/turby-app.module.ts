import { Module } from '@nestjs/common';
import { PlayerModule } from './turby/player.module';

// 터비 전용 Nest 모듈 — room gateway 패턴(src/rooms/)은 room/전투 로직 확정 후 추가 예정(3.5.3/3.5.4).
// 우선 DB<->BE<->FE 연동 검증용으로 플레이어 식별+인벤토리(player.module.ts)만 먼저 연결.
@Module({
  imports: [PlayerModule],
})
export class TurbyAppModule {}
