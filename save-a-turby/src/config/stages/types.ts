// 3.5.1 맵(탐험) 데이터 — 오펜스 타워의 config/stages/ 패턴(StageDef + 파일 분리 + STAGES 배열) 재사용
export interface WildSpawn {
  x: number;
  y: number;
  characterCode: string; // characters.json의 code
}

export interface StageDef {
  code: string; // backgrounds.json의 code와 일치
  name: string;
  width: number;
  height: number;
  wildSpawns: WildSpawn[];
}
