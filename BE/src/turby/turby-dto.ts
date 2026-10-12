import { HttpException } from '@nestjs/common';

// 게임 규칙 위반을 { code, message }로 내려서 클라이언트가 문구를 코드로 구분할 수 있게 함
export function gameError(status: number, code: string, message: string) {
  return new HttpException({ code, message }, status);
}

// 경로·본문으로 받은 숫자 ID(플레이어·터비). 숫자 문자열이 아니면 BigInt 변환 예외(500) 대신 400으로 거절한다
export function parseId(value: unknown, what = 'ID'): bigint {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw gameError(400, 'INVALID_ID', `${what} 정보가 올바르지 않습니다.`);
  return BigInt(value);
}

export const INSTANCE_INCLUDE = {
  turby_character: { include: { turby_grade: true } },
  player_base_slot: true,
  turby_equipment: { include: { item_definition: true } },
} as const;

type ItemBonus = { atk_bonus: number; def_bonus: number; ap_bonus: number; hp_bonus: number };

export type InstanceRow = {
  id: bigint;
  acquired_via: string;
  atk_bonus: number;
  def_bonus: number;
  ap_bonus: number;
  hp_bonus: number;
  base_slot_id: bigint | null;
  turby_character: {
    code: string;
    name: string;
    atk_mod: number;
    def_mod: number;
    ap_mod: number;
    hp_mod: number;
    turby_grade: { base_attack: number | null; base_defense: number | null; base_action_power: number | null; base_hp: number | null };
  };
  player_base_slot?: { slot_index: number } | null;
  turby_equipment: { slot_key: string; item_definition: ItemBonus & { code: string; name: string } }[];
};

// 6.2 스탯 산정 공식(등급 기본 + 캐릭터 보정치) + 개별 강화 보너스(turby_instance.*_bonus) + 장착 아이템 보너스(3.1).
// 최종 스탯까지 서버에서 계산해서 내려줌.
export function toTurbyDto(instance: InstanceRow) {
  const { turby_character: character, turby_equipment: equipment } = instance;
  const grade = character.turby_grade;
  const sum = (pick: (i: ItemBonus) => number) => equipment.reduce((acc, e) => acc + pick(e.item_definition), 0);
  return {
    id: instance.id.toString(),
    characterCode: character.code,
    characterName: character.name,
    acquiredVia: instance.acquired_via,
    // 4.2: base_slot_id 없으면 소지(가방), 있으면 기지 보관(선반)
    locationType: instance.base_slot_id === null ? ('bag' as const) : ('shelf' as const),
    slotIndex: instance.player_base_slot?.slot_index ?? null,
    equipment: equipment.map((e) => ({ slotKey: e.slot_key, itemCode: e.item_definition.code, itemName: e.item_definition.name })),
    stats: {
      attack: (grade.base_attack ?? 0) + character.atk_mod + instance.atk_bonus + sum((i) => i.atk_bonus),
      defense: (grade.base_defense ?? 0) + character.def_mod + instance.def_bonus + sum((i) => i.def_bonus),
      actionPower: (grade.base_action_power ?? 0) + character.ap_mod + instance.ap_bonus + sum((i) => i.ap_bonus),
      maxHp: (grade.base_hp ?? 0) + character.hp_mod + instance.hp_bonus + sum((i) => i.hp_bonus),
    },
  };
}

// 야생 터비처럼 인스턴스·장비가 없는 캐릭터의 스탯(등급 기본 + 캐릭터 보정치)
export function baseStatsOf(character: InstanceRow['turby_character']) {
  const grade = character.turby_grade;
  return {
    attack: (grade.base_attack ?? 0) + character.atk_mod,
    defense: (grade.base_defense ?? 0) + character.def_mod,
    actionPower: (grade.base_action_power ?? 0) + character.ap_mod,
    maxHp: (grade.base_hp ?? 0) + character.hp_mod,
  };
}
