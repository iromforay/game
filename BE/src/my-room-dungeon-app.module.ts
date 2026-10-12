import { Module } from '@nestjs/common';
import { ScoreboardModule } from './scoreboard/scoreboard.module';

// 내 방이 던전 전용 프로세스. 현재는 계정 인증과 저장 프로필 API만 제공한다.
// 다른 게임 서버와 분리해 개발/배포 시 서로 재시작하지 않아도 된다.
@Module({
  imports: [ScoreboardModule],
})
export class MyRoomDungeonAppModule {}
