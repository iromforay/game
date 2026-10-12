import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../rooms/settings.service';
import { gameError } from '../turby-dto';
import { toCheckpoint } from './story-rules';
import { OPENING_REQUIRED_HINT, gateByOpening, legacyServerCanEnter, legacyStatuses, openingDone, v2Statuses, type ChapterRow, type StageStatusDto } from './stage-access';

// 지역 입장 판정의 단일 출처(M2). 탐험 세션 입장(rooms.service)과 GET /player/me/story의 stages가 모두 여기를 쓴다.
// story.stageAccessV2(game_setting, 기본 false)로 신·구 판정을 전환한다 — 롤백은 설정값만 되돌리면 된다.
// 구 판정은 롤백 경로라 기존 동작(story_chapter.clear_character_code + 직접 포획)을 그대로 보존한다.
@Injectable()
export class StageAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  isV2(): boolean {
    return this.settings.flag('story.stageAccessV2', false);
  }

  async statuses(playerId: bigint): Promise<StageStatusDto[]> {
    const chapters = await this.chapters();
    const progress = await this.prisma.player_story_progress.findUnique({ where: { player_id: playerId } });
    const checkpoint = toCheckpoint(progress?.checkpoint ?? 'OPENING_NOT_STARTED');
    if (this.isV2()) return gateByOpening(v2Statuses(chapters.rows, await this.events(playerId), checkpoint), checkpoint);
    const { clearCodeByOrder, nameByCode } = await this.legacyData(chapters.clearCodes);
    return gateByOpening(legacyStatuses(chapters.rows, clearCodeByOrder, nameByCode, await this.capturedCodes(playerId), checkpoint), checkpoint);
  }

  // 오프닝 완료 여부(v15). 진행 행이 없으면 미완료다 — 기존 데이터로 완료 처리하지 않는다
  async openingComplete(playerId: bigint): Promise<boolean> {
    const progress = await this.prisma.player_story_progress.findUnique({ where: { player_id: playerId } });
    return openingDone(toCheckpoint(progress?.checkpoint ?? 'OPENING_NOT_STARTED'));
  }

  async requireOpeningComplete(playerId: bigint) {
    if (!(await this.openingComplete(playerId))) throw gameError(403, 'OPENING_REQUIRED', OPENING_REQUIRED_HINT);
  }

  // 탐험 세션 입장 거부 사유(null이면 허용). 오프닝 선행 조건이 먼저다.
  async entryDenial(playerId: bigint, stageCode: string, chapterOrder: number): Promise<'OPENING_REQUIRED' | 'STAGE_LOCKED' | null> {
    if (!(await this.openingComplete(playerId))) return 'OPENING_REQUIRED';
    if (this.isV2()) {
      const status = (await this.statuses(playerId)).find((s) => s.stageCode === stageCode);
      return status?.canEnter ? null : 'STAGE_LOCKED';
    }
    const chapters = await this.chapters();
    return legacyServerCanEnter(chapterOrder, chapters.clearCodes, await this.capturedCodes(playerId)) ? null : 'STAGE_LOCKED';
  }

  async canEnter(playerId: bigint, stageCode: string, chapterOrder: number): Promise<boolean> {
    return (await this.entryDenial(playerId, stageCode, chapterOrder)) === null;
  }

  async requireEnter(playerId: bigint, stageCode: string, chapterOrder: number) {
    const denial = await this.entryDenial(playerId, stageCode, chapterOrder);
    if (denial === 'OPENING_REQUIRED') throw gameError(403, 'OPENING_REQUIRED', OPENING_REQUIRED_HINT);
    if (denial) throw gameError(403, 'STAGE_LOCKED', '아직 열리지 않은 지역입니다.');
  }

  private async chapters() {
    const rows = await this.prisma.story_chapter.findMany({ orderBy: { chapter_order: 'asc' } });
    return {
      rows: rows.map((r): ChapterRow => ({ order: r.chapter_order, stageCode: r.stage_code, title: r.title })),
      clearCodes: new Map(rows.map((r) => [r.chapter_order, r.clear_character_code])),
    };
  }

  private async events(playerId: bigint): Promise<Set<string>> {
    const rows = await this.prisma.player_story_event.findMany({ where: { player_id: playerId }, select: { event_id: true } });
    return new Set(rows.map((r) => r.event_id));
  }

  // 구 판정: 직접 포획(wild_capture)한 캐릭터 코드
  private async capturedCodes(playerId: bigint): Promise<Set<string>> {
    const caught = await this.prisma.turby_instance.findMany({ where: { owner_player_id: playerId, acquired_via: 'wild_capture' }, select: { character_id: true } });
    if (caught.length === 0) return new Set();
    const chars = await this.prisma.turby_character.findMany({ where: { id: { in: [...new Set(caught.map((c) => c.character_id))] } }, select: { code: true } });
    return new Set(chars.map((c) => c.code));
  }

  private async legacyData(clearCodeByOrder: Map<number, string>) {
    const chars = await this.prisma.turby_character.findMany({ where: { code: { in: [...clearCodeByOrder.values()] } }, select: { code: true, name: true } });
    return { clearCodeByOrder, nameByCode: new Map(chars.map((c) => [c.code, c.name])) };
  }
}
