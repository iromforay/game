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

  // 인벤토리 "누비에게 장착": 유물 코드만 받는다(이벤트·대상 터비는 서버가 정함). 응답 play = 장착 장면
  @Post('story/relics/:itemCode/equip')
  @HttpCode(200)
  async equipRelic(@Headers(SESSION_HEADER) token: string, @Param('itemCode') itemCode: string) {
    return this.story.equipRelic(await this.session.require(token), itemCode);
  }

  // 이야기 지점 상호작용(보풀이 전달 등). 서버가 위치·진행·보유 수량을 판정하고 재생할 구간을 돌려준다
  @Post('story/triggers/:triggerId')
  @HttpCode(200)
  async trigger(@Headers(SESSION_HEADER) token: string, @Param('triggerId') triggerId: string) {
    return this.story.trigger(await this.session.require(token), triggerId);
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
