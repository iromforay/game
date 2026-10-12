// 조우 반경(px) — 서버 조우 판정과 클라이언트에 내려 주는 Map 계약의 유일한 출처(10-06 v1 §3). 설정(game_setting)의 값을 그대로 쓰되
// 숫자가 아니거나 0 이하이면 설정 오류로 본다(클라이언트에 이상한 값을 내려 보내지 않는다).
export function encounterRadiusPx(settings: { number(key: string): number }): number {
  const v = settings.number('battle.encounterRadiusPx');
  if (!Number.isFinite(v) || v <= 0) throw new Error('game_setting "battle.encounterRadiusPx" must be a positive number');
  return v;
}
