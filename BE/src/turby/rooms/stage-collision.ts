// 지역 이동 충돌(서버 쪽 입구) — 규칙과 타입은 shared/turby-stage-geometry 패키지 한 곳에 있다(클라이언트도 같은 패키지를 쓴다, 10-02 v6 §2).
// 서버는 "마지막으로 승인한 위치 → 새로 보고된 위치" 선분을 검사한다: 끝점만이 아니라 선분이 벽·닫힌 문을 지나는지도 본다(터널링 방지).
// 최종 지도로 바꿔도 이 계약은 그대로다: 지도 크기, 시작 지점, 통과 불가 사각형, 문(열리는 이벤트), 접근 조건이 있는 구역.
import { bodyBlocked, parseStageGeometry, segmentBlocked, SERVER_BODY_HALF, type Point, type Rect, type StageGeometry } from 'turby-stage-geometry';

export { checkMove, inBounds, inLockedZone, lockedZonesFor, reachVerdict, safePosition, segmentBlocked, segmentCrosses, solidsFor, SERVER_BODY_HALF } from 'turby-stage-geometry';
export type { MoveVerdict, Point, ReachVerdict, Rect } from 'turby-stage-geometry';
export type StageCollision = StageGeometry;

// 지역 JSON → 계약. 지역 데이터가 없는 지역은 지도 한가운데에서 시작하고 막힌 곳이 없다. 계약에 맞지 않으면 StageGeometryError
export function collisionOf(data: unknown, mapWidth: number, mapHeight: number, stageCode?: string): StageCollision {
  return parseStageGeometry(data, { width: mapWidth, height: mapHeight }, stageCode);
}

// 몸(서버 반지름)이 통과 불가 사각형에 겹치는가
export function pointBlocked(solids: Rect[], p: Point, half = SERVER_BODY_HALF): boolean {
  return bodyBlocked(solids, p, half);
}

// 위치 증거: 서 있는 자리에서 대상까지 벽·닫힌 문이 가로막고 있지 않은가(벽 반대편에서 가까운 것은 닿지 않는다)
export function reachable(solids: Rect[], from: Point, target: Point): boolean {
  return !segmentBlocked(solids, from, target);
}
