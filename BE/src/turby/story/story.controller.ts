import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { SESSION_HEADER, SessionService } from '../session.service';
import { StoryService } from './story.service';

// 스토리 API(m0_design 4.2). 체크포인트 값을 입력받는 경로는 없다 — 클라이언트는 "이벤트 완료 요청"만 보낸다.
@Controller('player/me')
export class StoryController {
  constructor(
    private readonly session: SessionService,
    private readonly story: StoryService,
  ) {}

  @Get('story')
  async state(@Headers(SESSION_HEADER) token: string) {
    return this.story.getState(await this.session.require(token));
  }

  // body.requestId는 로그 추적용. 멱등성은 (player, event) unique가 보장한다.
  @Post('story/events/:eventId/complete')
  @HttpCode(200)
  async complete(@Headers(SESSION_HEADER) token: string, @Param('eventId') eventId: string) {
    return this.story.completeEvent(await this.session.require(token), eventId, 'rest');
  }

  @Post('story/objectives/:objectiveKey/progress')
  @HttpCode(200)
  async progress(@Headers(SESSION_HEADER) token: string, @Param('objectiveKey') objectiveKey: string, @Body('objectId') objectId: unknown) {
    return this.story.collectObject(await this.session.require(token), objectiveKey, objectId);
  }

  @Post('profile/name')
  @HttpCode(200)
  async name(@Headers(SESSION_HEADER) token: string, @Body('name') name: unknown) {
    return this.story.saveName(await this.session.require(token), name);
  }

  @Get('story/dialogue/:chapterCode')
  async dialogue(@Headers(SESSION_HEADER) token: string, @Param('chapterCode') chapterCode: string) {
    return this.story.dialogue(await this.session.require(token), chapterCode);
  }

  @Get('story/stages/:stageCode')
  async stage(@Headers(SESSION_HEADER) token: string, @Param('stageCode') stageCode: string) {
    return this.story.stageData(await this.session.require(token), stageCode);
  }
}
