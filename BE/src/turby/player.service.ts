import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SessionService } from './session.service';
import { INSTANCE_INCLUDE, gameError, parseId, toTurbyDto } from './turby-dto';

// 4.4: 선반 슬롯 수 제안(8열×5행) — 문서 5.2-4 최종 확정 전까지 이 값 사용
const SHELF_SLOT_COUNT = 40;
// 4.1/4.5: 게임 시작 지급 타레(정해진 금액)
const STARTING_TARE = 100;

@Injectable()
export class PlayerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  // 8번 스키마: 로그인 시스템이 없어 device_uuid로 플레이어를 식별(없으면 새로 생성)
  async identify(deviceUuid: string) {
    const player = await this.prisma.player.upsert({
      where: { device_uuid: deviceUuid },
      update: {},
      create: { device_uuid: deviceUuid, nickname: '터비 탐험가', tare_balance: STARTING_TARE },
    });

    // 스토리 M3: 스타터 누비 자동 지급을 없앴다. 이야기 누비는 오프닝 완료 이벤트(story_nubi_granted)가
    // 이름 입력 뒤에 한 트랜잭션으로 지급·연결한다(기존 계정은 가장 오래된 스타터를 재사용, 없으면 그때 생성).
    const turbys = await this.getInventory(player.id);

    // 스토리 M1: 세션 토큰 발급(이미 있으면 그대로). 이후 /player/me/* 헤더(X-Turby-Session)와 소켓 hello에 쓴다.
    const sessionToken = await this.session.ensureToken(player.id, player.session_token);
    return { playerId: player.id.toString(), nickname: player.nickname, tareBalance: player.tare_balance, turbys, sessionToken };
  }

  async getInventory(playerId: bigint) {
    const instances = await this.prisma.turby_instance.findMany({
      where: { owner_player_id: playerId },
      include: INSTANCE_INCLUDE,
      orderBy: { created_at: 'asc' },
    });
    return instances.map(toTurbyDto);
  }

  // 4.2/4.4: 소지(가방) → 기지 보관(선반) 특정 슬롯으로 이동.
  // 한 트랜잭션에서 행을 잠근 뒤 점유를 다시 확인한다(10-01 v2 §1) — 같은 칸으로 동시에 온 요청이 둘 다 "빈 칸"으로 보지 못하게.
  // 잠금 순서는 항상 플레이어 → 터비 → 슬롯(교착 방지). 플레이어 행 잠금이 그 플레이어의 선반·가방 이동을 한 줄로 세운다.
  // 이야기 누비도 선반에 둘 수 있다(m0_design 9절·checkpoint_spec: 선반에 있어도 스토리 전투에는 서버가 불러온다).
  async moveToShelf(playerIdStr: string, turbyIdStr: string, slotIndex: number) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SHELF_SLOT_COUNT) {
      throw new BadRequestException(`slotIndex must be 0-${SHELF_SLOT_COUNT - 1}`);
    }
    const playerId = parseId(playerIdStr, '플레이어');
    const turbyId = parseId(turbyIdStr, '터비');

    return this.prisma.$transaction(async (tx) => {
      const turby = await this.lockOwnedTurby(tx, playerId, turbyId);
      const slot = await tx.player_base_slot.upsert({
        where: { player_id_slot_index: { player_id: playerId, slot_index: slotIndex } },
        update: {},
        create: { player_id: playerId, slot_index: slotIndex },
      });
      await tx.$queryRaw`SELECT id FROM player_base_slot WHERE id = ${slot.id} FOR UPDATE`;

      // 잠금 뒤 재확인: 다른 터비가 이 칸에 있으면 거부(원래 위치는 그대로)
      const occupant = await tx.turby_instance.findFirst({ where: { base_slot_id: slot.id, id: { not: turbyId } } });
      if (occupant) throw gameError(409, 'SHELF_SLOT_OCCUPIED', '이미 다른 터비가 있는 칸입니다.');

      // 이미 이 칸에 있는 같은 터비의 재요청은 그대로 성공(멱등)
      if (turby.base_slot_id === null || turby.base_slot_id.toString() !== slot.id.toString()) {
        await tx.turby_instance.update({ where: { id: turbyId }, data: { base_slot_id: slot.id } });
      }
      return toTurbyDto(await tx.turby_instance.findUniqueOrThrow({ where: { id: turbyId }, include: INSTANCE_INCLUDE }));
    });
  }

  // 4.2: 기지 보관(선반) → 소지(가방)로 이동. 선반 이동과 같은 잠금 순서를 써서 겹쳐 와도 최종 상태는 하나다
  async moveToBag(playerIdStr: string, turbyIdStr: string) {
    const playerId = parseId(playerIdStr, '플레이어');
    const turbyId = parseId(turbyIdStr, '터비');

    return this.prisma.$transaction(async (tx) => {
      const turby = await this.lockOwnedTurby(tx, playerId, turbyId);
      if (turby.base_slot_id !== null) await tx.turby_instance.update({ where: { id: turbyId }, data: { base_slot_id: null } });
      return toTurbyDto(await tx.turby_instance.findUniqueOrThrow({ where: { id: turbyId }, include: INSTANCE_INCLUDE }));
    });
  }

  // 플레이어 행 → 터비 행 순서로 잠그고 소유권을 확인한다. 값은 모두 바인딩 변수로 넘긴다(문자열을 SQL에 이어 붙이지 않음)
  private async lockOwnedTurby(tx: Prisma.TransactionClient, playerId: bigint, turbyId: bigint) {
    const players = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM player WHERE id = ${playerId} FOR UPDATE`;
    if (players.length === 0) throw new NotFoundException('player not found');
    const rows = await tx.$queryRaw<{ id: bigint; owner_player_id: bigint; base_slot_id: bigint | null }[]>`SELECT id, owner_player_id, base_slot_id FROM turby_instance WHERE id = ${turbyId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('turby not found');
    if (rows[0].owner_player_id.toString() !== playerId.toString()) throw gameError(403, 'NOT_YOUR_TURBY', '내 터비가 아닙니다.');
    return rows[0];
  }
}
