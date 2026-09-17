import charactersData from '../data/characters.json';
import { GRADES } from '../config/grades';

export interface UnitStats {
  name: string;
  characterCode: string;
  attack: number;
  defense: number;
  actionPower: number;
  maxHp: number;
}

// 6.2 스탯 산정 공식: 등급 기본 스탯 + 캐릭터 보정치(+착용 아이템 보너스는 3.1, 아직 미구현)
export function getUnitStats(characterCode: string): UnitStats {
  const character = (charactersData as { code: string; name: string; gradeId: number; atkMod: number; defMod: number; apMod: number; hpMod: number }[]).find(
    (c) => c.code === characterCode,
  );
  if (!character) throw new Error(`unknown character code: ${characterCode}`);
  const grade = GRADES.find((g) => g.id === character.gradeId);
  if (!grade || grade.baseAttack === null) throw new Error(`grade stats not confirmed for character: ${characterCode}`);

  return {
    name: character.name,
    characterCode,
    attack: grade.baseAttack + character.atkMod,
    defense: (grade.baseDefense ?? 0) + character.defMod,
    actionPower: (grade.baseActionPower ?? 0) + character.apMod,
    maxHp: (grade.baseHp ?? 0) + character.hpMod,
  };
}
