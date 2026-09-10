export interface UnitStats {
  id: string;
  hp: number;
  speed: number; // px/sec
  reward: number; // gold granted to the attacker (AI) when this unit dies
  color: number;
  radius: number;
}
