// 3.5.1 맵(탐험) 데이터 — 오펜스 타워의 config/stages/ 패턴(StageDef + 파일 분리 + STAGES 배열) 재사용.
// 10-02 v6 §1: 야생 터비의 위치·종류는 여기 두지 않는다 — 서버가 내려 준 마커(roomClient.wilds)만 쓴다.
// width·height는 서버의 지역 화면 응답을 받지 못했을 때만 쓰는 임시 표시 크기다(판정에 쓰지 않는다).
export interface StageDef {
  code: string; // backgrounds.json의 code와 일치
  name: string;
  width: number;
  height: number;
}
