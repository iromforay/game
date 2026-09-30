// 전투 화면 판정(M4-B) — Phaser와 분리된 순수 모듈(test/battleView.test.ts).
// 규칙의 기준은 서버(BE/src/turby/battle/battle-engine.ts)다. 여기서는 같은 규칙으로 "누를 수 있는 것"만 미리 보여 주고,
// 실제 판정·거부(TILE_BLOCKED/PART_ORDER/TARGET_PROTECTED 등)는 서버 응답을 따른다.
import type { BattleObjective, BattleOutcome, BattleSnapshot, BattleUnit } from '../net/battleTypes';

export const STORY_BADGE = '스토리 전투';
export const STORY_NOTICE = '포획과 야생 보상이 없는 전투예요';

type Cell = { col: number; row: number };
const cellKey = (col: number, row: number) => `${col},${row}`;
const dist = (a: Cell, b: Cell) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const isLive = (u: BattleUnit) => !u.stunned && !u.inactive;

export const isStoryBattle = (snap: BattleSnapshot) => !!snap.story;

// 꼭짓점 퇴각존: 야생 전투는 항상, 정의(스토리) 전투는 정의가 켠 경우만
export const showsCornerEscape = (snap: BattleSnapshot) => snap.cornerEscape ?? true;

export function isBlocked(snap: BattleSnapshot, col: number, row: number) {
  return !!snap.blocked?.includes(cellKey(col, row));
}

// 이동에 쓸 수 있는 AP(속박 감소량 반영, 0 미만 없음)
export function moveAllowance(u: BattleUnit) {
  const penalty = (u.statuses ?? []).reduce((sum, s) => sum + (s.kind === 'bind' ? s.movePenalty : 0), 0);
  return Math.max(0, u.ap - penalty);
}

// 갈 수 있는 칸과 비용. 막힌 칸이 없으면 맨해튼 거리, 있으면 막힌 칸을 피한 최단 경로(유닛은 경로를 막지 않고 도착 칸만 비어 있어야 함)
export function reachableCells(snap: BattleSnapshot, u: BattleUnit): { col: number; row: number; cost: number }[] {
  const limit = moveAllowance(u);
  if (u.ap < 1 || limit < 1) return [];
  const cost = new Map<string, number>([[cellKey(u.col, u.row), 0]]);
  let frontier: Cell[] = [{ col: u.col, row: u.row }];
  for (let step = 1; step <= limit && frontier.length > 0; step++) {
    const next: Cell[] = [];
    for (const c of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const col = c.col + dc;
        const row = c.row + dr;
        if (col < 0 || row < 0 || col >= snap.grid.cols || row >= snap.grid.rows) continue;
        const k = cellKey(col, row);
        if (cost.has(k) || isBlocked(snap, col, row)) continue;
        cost.set(k, step);
        next.push({ col, row });
      }
    }
    frontier = next;
  }
  const occupied = new Set(snap.units.filter((o) => o !== u && isLive(o)).map((o) => cellKey(o.col, o.row)));
  return [...cost.entries()]
    .filter(([k, c]) => c > 0 && !occupied.has(k))
    .map(([k, c]) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row, cost: c };
    });
}

// 대상 상태: ok / 공격 대상 아님(아군·중립·기절) / 부위 순서 아님 / 부위가 남은 중심부
export type TargetState = 'ok' | 'not_target' | 'part_order' | 'protected';

export function targetState(snap: BattleSnapshot, target: BattleUnit): TargetState {
  if (target.side !== 'wild' || !isLive(target) || target.targetable === false) return 'not_target';
  if (target.partOf) {
    // 살아 있는 부위 중 가장 작은 순서만 공격할 수 있다(엔진 attack()과 같은 판정)
    const first = Math.min(...snap.units.filter((p) => p.partOf === target.partOf && !p.stunned).map((p) => p.breakOrder ?? 0));
    if ((target.breakOrder ?? 0) !== first) return 'part_order';
  }
  if (target.invulnerable) return 'protected';
  return 'ok';
}

export const TARGET_HINT: Record<Exclude<TargetState, 'ok' | 'not_target'>, string> = {
  part_order: '먼저 끊어야 할 부위가 남아 있어요',
  protected: '바깥 부위를 먼저 끊어야 해요',
};

export function canAttack(snap: BattleSnapshot, attacker: BattleUnit, target: BattleUnit) {
  return isLive(attacker) && attacker.ap >= 1 && dist(attacker, target) === 1 && targetState(snap, target) === 'ok';
}

const namesOf = (snap: BattleSnapshot, ids: string[]) => ids.map((id) => snap.units.find((u) => u.unitId === id)?.name ?? id).join(', ');

// 현재 목표 문구(정의 전투만). 기본 패배 조건(아군 전원 기절)은 모든 전투 공통이라 따로 적지 않는다.
export function objectiveLines(snap: BattleSnapshot): string[] {
  if (!snap.objectives) return [];
  const lines: string[] = [];
  for (const o of snap.objectives.win) lines.push(winText(snap, o));
  for (const o of snap.objectives.lose) if (o.kind === 'protect') lines.push(`${namesOf(snap, o.unitIds)} 지키기 — 쓰러지면 패배`);
  return lines.filter((l) => l.length > 0);
}

function winText(snap: BattleSnapshot, o: BattleObjective) {
  if (o.kind === 'defeat_all') return '적을 모두 물리치기';
  if (o.kind === 'defeat_units') return `${namesOf(snap, o.unitIds)} 쓰러뜨리기`;
  return '';
}

// 유닛 이름표 뒤에 붙는 상태 표식
export function unitTags(u: BattleUnit): string[] {
  const tags: string[] = [];
  if (u.fled) return ['도주'];
  if (u.stunned) tags.push('기절');
  if (u.inactive) tags.push('이탈');
  if (u.side === 'neutral') tags.push('보호 대상');
  if (u.invulnerable) tags.push('부위 먼저');
  for (const s of u.statuses ?? []) if (s.kind === 'bind') tags.push(`속박 ${s.turnsLeft}`);
  return tags;
}

// 스토리 전투 결과 문구 — 포획 문구 대신 쓴다
export function storyResultText(outcome: BattleOutcome): { title: string; sub: string; btn: string } {
  if (outcome === 'win') return { title: '전투 승리!', sub: STORY_NOTICE, btn: '이야기 계속하기' };
  if (outcome === 'lose') return { title: '전투에서 졌어요', sub: '전투 직전부터 다시 도전할 수 있어요', btn: '돌아가기' };
  return { title: '전투가 끝나지 않았어요', sub: '전투 직전부터 다시 도전할 수 있어요', btn: '돌아가기' };
}

// 스토리 전투가 끝나거나 취소되면 돌아갈 화면(대화 진행기를 띄운 화면). 없으면 기존처럼 맵으로.
export interface BattleReturn {
  scene: string;
  data?: Record<string, unknown>;
  mode?: 'start' | 'wake'; // wake: 잠들어 있는 대화 화면을 깨워 이어 간다(대화 진행 위치 유지), start: 새로 시작(새로고침 복원)
}
export interface StoryBattleEnd {
  encounterKey: string;
  outcome: BattleOutcome;
}
export function returnDestination(ret: BattleReturn | undefined, fallback: BattleReturn, end: StoryBattleEnd | null): { scene: string; data: Record<string, unknown>; mode: 'start' | 'wake' } {
  if (!ret) return { scene: fallback.scene, data: fallback.data ?? {}, mode: 'start' };
  return { scene: ret.scene, data: { ...(ret.data ?? {}), ...(end ? { storyBattleEnd: end } : {}) }, mode: ret.mode ?? 'start' };
}

// 이름·HP 라벨 위치(인접 유닛끼리 겹치지 않게). 같은 줄에서 왼쪽으로 붙어 있는 유닛 수가 홀수면 위, 짝수면 아래.
// 단, 바로 위 칸 유닛의 라벨이 아래(=이 칸 위쪽 경계)에 있으면 부딪히므로 아래로 둔다. 문구는 줄이지 않고 칸 너비로 줄바꿈한다.
export function labelPlacement(snap: BattleSnapshot, u: BattleUnit): 'below' | 'above' {
  const shown = (col: number, row: number) => snap.units.find((o) => o.col === col && o.row === row && !o.fled && !o.inactive);
  const memo = new Map<string, 'below' | 'above'>();
  const place = (unit: BattleUnit): 'below' | 'above' => {
    const key = unit.unitId;
    const cached = memo.get(key);
    if (cached) return cached;
    let run = 0;
    while (shown(unit.col - run - 1, unit.row)) run++;
    let result: 'below' | 'above' = run % 2 === 1 ? 'above' : 'below';
    const up = shown(unit.col, unit.row - 1);
    if (result === 'above' && up && place(up) === 'below') result = 'below';
    memo.set(key, result);
    return result;
  };
  return place(u);
}

// ---------- 전투 HUD 배치(v3 §5) ----------
// 우선순위: 턴(가장 크게) > 행동 안내 > 목표. 작은 화면에서는 목표 패널을 접고(버튼으로 펼침) 유닛 라벨을 짧은 한 줄로.
type HudRect = { x: number; y: number; w: number; h: number };
export interface BattleHudLayout {
  mode: 'regular' | 'compact';
  font: { status: number; hint: number; button: number; panelTitle: number; panel: number; label: number };
  objectivesCollapsible: boolean;
  labelWrap: number;
  // 누르는 영역·글자 영역(캔버스 좌표). 서로 겹치지 않는다(v4 §4.1 — 테스트로 확인)
  rects: {
    endTurn: HudRect; // 오른쪽 위
    goalButton: HudRect | null; // 작은 화면: 왼쪽 위 목표 요약 버튼
    goalPanel: HudRect | null; // 작은 화면: 펼친 목표 상세(오른쪽 위 — 아군이 시작하는 왼쪽을 가리지 않게), 높이는 최대치
    turn: HudRect; // 가운데 위 턴 표시
    leave: HudRect; // 왼쪽 아래
    hint: HudRect; // 나가기 버튼 오른쪽 남은 폭(한 줄)
  };
}
export function battleHudLayout(scale: number, tile = 80): BattleHudLayout {
  const compact = scale < 0.75;
  const f = (base: number, min: number) => Math.max(base, Math.ceil(min / Math.max(0.1, scale)));
  const font = { status: f(22, 16), hint: f(15, 13), button: f(18, 14), panelTitle: f(18, 14), panel: f(15, 12), label: f(13, 12) };
  const btnH = Math.round(font.button * 1.9);
  const endTurn = { x: 1280 - 8 - Math.round(font.button * 5.2), y: 4, w: Math.round(font.button * 5.2), h: btnH };
  const leave = { x: 8, y: 720 - 6 - btnH, w: Math.round(font.button * 6.2), h: btnH };
  const hintH = Math.round(font.hint * 1.6);
  const hint = compact ? { x: leave.x + leave.w + 12, y: 720 - 6 - hintH, w: 1280 - (leave.x + leave.w + 12) - 8, h: hintH } : { x: 260, y: 720 - 6 - hintH, w: 760, h: hintH };
  const goalButton = compact ? { x: 8, y: 4, w: 540, h: btnH } : null; // 목표 요약 한 줄이 들어가는 폭
  const turn = compact ? { x: goalButton!.x + goalButton!.w + 12, y: 4, w: endTurn.x - 12 - (goalButton!.x + goalButton!.w + 12), h: btnH } : { x: 380, y: 0, w: 520, h: 56 };
  const goalPanel = compact ? { x: 1280 - 8 - 620, y: endTurn.y + endTurn.h + 8, w: 620, h: 260 } : null;
  return { mode: compact ? 'compact' : 'regular', font, objectivesCollapsible: compact, labelWrap: tile * 2 - 12, rects: { endTurn, goalButton, goalPanel, turn, leave, hint } };
}

// 하단 행동 안내(UI 문구). 작은 화면에서는 한 줄에 들어가게 짧게
export function actionHint(unitName: string | null, compact: boolean): string {
  if (!unitName) return compact ? '움직일 유닛이 없어요 · 턴 종료' : '행동할 수 있는 유닛이 없습니다. 턴 종료를 눌러주세요';
  return compact ? `${unitName} · 칸=이동 · 적=공격 · 자신=다음` : `${unitName}: 이동할 칸/다른 유닛 선택, 더 할 게 없으면 자신을 눌러 다음 유닛으로`;
}

// 목표 요약(작은 화면 버튼): 첫 목표 + 나머지 개수
export function goalSummary(lines: string[]): string {
  if (lines.length === 0) return '목표';
  return `목표: ${lines[0]}${lines.length > 1 ? ` 외 ${lines.length - 1}` : ''} ▾`;
}

// 작은 화면의 유닛 라벨: "이름 HP/최대" 한 줄 + 상태 표식은 짧은 UI 표기로 둘째 줄(대본 문구가 아님)
const SHORT_TAG: Record<string, string> = { '보호 대상': '보호', '부위 먼저': '부위 먼저' };
export function unitLabel(u: BattleUnit, compact: boolean): string {
  const tags = unitTags(u);
  if (!compact) return `${u.name} HP ${u.hp}/${u.maxHp}${tags.length > 0 ? ` (${tags.join(' · ')})` : ''}`;
  const short = tags.map((t) => SHORT_TAG[t] ?? t);
  return `${u.name} ${u.hp}/${u.maxHp}${short.length > 0 ? `\n${short.join(' · ')}` : ''}`;
}

// 라벨이 격자·화면 밖으로 나가지 않게 가운데 좌표를 끌어온다(bounds 안에 w×h 상자가 들어오도록)
export function clampLabel(cx: number, top: number, w: number, h: number, bounds: { x: number; y: number; w: number; h: number }): { cx: number; top: number } {
  const minX = bounds.x + w / 2;
  const maxX = bounds.x + bounds.w - w / 2;
  return { cx: Math.min(Math.max(cx, minX), Math.max(minX, maxX)), top: Math.min(Math.max(top, bounds.y), bounds.y + bounds.h - h) };
}
