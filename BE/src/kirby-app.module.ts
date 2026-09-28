import { Module } from '@nestjs/common';
import { KirbyModule } from './kirby/kirby.module';
import { ScoreboardModule } from './scoreboard/scoreboard.module';

// 커비 훔치기 전용 Nest 모듈 — 9번 작업순서 4단계(침입/실시간 추격·타격) 구현.
// 허브 공통 기능(계정·스코어보드)도 이 서버로 호출한다(운영에서 HTTP 접근이 확인된 BE).
@Module({
  imports: [KirbyModule, ScoreboardModule],
})
export class KirbyAppModule {}
