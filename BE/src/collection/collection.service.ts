import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { baseStatsOf } from '../turby/turby-dto';

const DEVICE_UUID_MAX = 64;

@Injectable()
export class CollectionService {
  constructor(private readonly prisma: PrismaService) {}

  // 허브 도감은 조회만 한다. identify()처럼 플레이어를 만들거나 스타터를 지급하지 않는다.
  // 미획득 터비는 이름·등급·설명을 응답에 넣지 않아 클라이언트에서도 정체를 알 수 없게 한다.
  async turby(deviceUuidRaw: unknown) {
    const characters = await this.prisma.turby_character.findMany({
      include: { turby_grade: true },
      orderBy: [{ grade_id: 'asc' }, { id: 'asc' }],
    });

    const deviceUuid = typeof deviceUuidRaw === 'string' && deviceUuidRaw.length > 0 && deviceUuidRaw.length <= DEVICE_UUID_MAX ? deviceUuidRaw : null;
    const player = deviceUuid ? await this.prisma.player.findUnique({ where: { device_uuid: deviceUuid } }) : null;
    const ownedRows = player
      ? await this.prisma.turby_instance.groupBy({
          by: ['character_id'],
          where: { owner_player_id: player.id },
          _count: { _all: true },
          _min: { created_at: true },
        })
      : [];
    const owned = new Map(ownedRows.map((r) => [r.character_id, r]));

    const entries = characters.map((c, i) => {
      const no = i + 1;
      const row = owned.get(c.id);
      if (!row) return { no, owned: false as const, imageKey: c.image_key ?? c.code };
      return {
        no,
        owned: true as const,
        imageKey: c.image_key ?? c.code,
        code: c.code,
        name: c.name,
        grade: { id: c.grade_id, name: c.turby_grade.name },
        description: c.description,
        stats: baseStatsOf(c),
        count: row._count._all,
        firstAcquiredAt: row._min.created_at,
      };
    });

    return { playerFound: !!player, total: entries.length, ownedCount: owned.size, entries };
  }
}
