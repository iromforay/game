// 시험용 길 찾기: 서버가 승인할 수 있는 경유지 목록을 만든다(벽·닫힌 문을 돌아간다). 서버의 충돌 순수 함수를 그대로 쓴다.
// 제품 코드가 아니다 — 통합 테스트가 "걷는 시간"을 생략하되 벽은 통과하지 않도록 하기 위한 도우미.
import { segmentBlocked, type Point, type Rect } from '../../src/turby/rooms/stage-collision';

const grow = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 });

// from → to 로 가는 경유지(끝점 포함). 갈 수 없으면 null
export function routeTo(solids: Rect[], from: Point, to: Point): Point[] | null {
  const fat = solids.map((r) => grow(r, 12)); // 서버 끝점 판정(몸 반지름 8)보다 넉넉히 떨어져 지난다
  const corners = solids.flatMap((r) => {
    const g = grow(r, 28);
    return [{ x: g.x, y: g.y }, { x: g.x + g.width, y: g.y }, { x: g.x, y: g.y + g.height }, { x: g.x + g.width, y: g.y + g.height }];
  });
  const nodes = [from, to, ...corners];
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) return null;
    if (u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || segmentBlocked(fat, nodes[u], nodes[v])) continue;
      const d = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const path: Point[] = [];
  for (let at = 1; at > 0; at = prev[at]) path.unshift(nodes[at]);
  return path;
}
