// 시험용: 3장 마루바닥 밑의 길 골격(scripts/data/underfloor-skeleton.json)을 따라 걷는 경유지(10-16 C3-1).
// 키보드 이동은 8방향이라 직선이 아니므로 모든 구간을 STEP px 간격으로 촘촘히 나눈다. underfloor-layout.test.ts가 같은 골격의 통과 가능성을 따로 검증한다.
export interface Pt {
  x: number;
  y: number;
}
const STEP = 48;

export function densify(points: [number, number][], step = STEP): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push({ x: Math.round(ax + ((bx - ax) * k) / n), y: Math.round(ay + ((by - ay) * k) / n) });
  }
  return out;
}

// 각 경로는 앞 지점에서 출발한다(새로고침하면 입구 스폰에서 다시 시작).
export const SPAWN_TO_ELDER = densify([[330, 2080], [560, 1880], [860, 1760], [1130, 1650], [1230, 1660]]);
export const ELDER_TO_GLOVE = densify([[1230, 1660], [1180, 1450], [1240, 1330], [1300, 1270]]);
export const GLOVE_TO_BLANKET = densify([[1300, 1270], [1880, 1300]]);
export const BLANKET_TO_DOLL = densify([[1880, 1300], [1650, 1400], [1640, 1700], [1720, 1820]]);
export const DOLL_TO_AMBUSH = densify([[1720, 1820], [1640, 1700], [1600, 1500]]);
