// 개발용 가짜 터비 BE — 브라우저의 fetch를 가로채 /player/* 응답을 메모리로 흉내 낸다(게임 빌드에 포함되지 않음).
// M1 SQL 적용 전이라 실제 새 BE를 원격 DB에 붙일 수 없어서, Boot → 마을 → 이야기 선택 → 오프닝 흐름 캡처에만 쓴다.
// 판정 규칙은 서버(StoryService·story-rules)의 것을 옮긴 것이 아니라 캡처에 필요한 최소 흉내다. 실제 검증은 서버 테스트가 한다.
import opening from '../../BE/story-data/save-a-turby/dialogue/opening.json';

type Origin = 'new' | 'legacy_backfill';

const RESUME: Record<string, string | null> = {
  OPENING_NOT_STARTED: 'opening.fall',
  OPENING_FALL_COMPLETE: 'opening.meeting',
  OPENING_NAME_SAVED: 'opening.promise',
  OPENING_COMPLETE: null,
};
const NEXT: Record<string, string> = { opening_fall_completed: 'OPENING_FALL_COMPLETE', opening_name_saved: 'OPENING_NAME_SAVED', story_nubi_granted: 'OPENING_COMPLETE' };
const STAGES = [
  ['forest', '1장 — 숲'],
  ['lake', '2장 — 호수'],
  ['underground', '3장 — 지하'],
  ['ice', '4장 — 얼음'],
  ['desert', '5장 — 사막'],
] as const;

export function installFakeBackend(opts: { origin: Origin; nickname: string; checkpoint?: string; baseUrl: string }) {
  let checkpoint = opts.checkpoint ?? 'OPENING_NOT_STARTED';
  let nickname = opts.nickname;
  const hasStarter = opts.origin === 'legacy_backfill';
  let nubiGranted = false;

  const turbys = () =>
    hasStarter || nubiGranted
      ? [{ id: '1', characterCode: 'nubi', characterName: '누비', acquiredVia: 'starter', locationType: 'bag', slotIndex: null, equipment: [], stats: { attack: 10, defense: 8, actionPower: 5, maxHp: 30 } }]
      : [];
  const done = () => checkpoint === 'OPENING_COMPLETE';
  const story = () => ({
    checkpoint,
    chapterCode: done() ? 'ch01' : 'opening',
    resume: { segmentId: RESUME[checkpoint] ?? null, tutorial: null },
    needsName: checkpoint === 'OPENING_NOT_STARTED' || checkpoint === 'OPENING_FALL_COMPLETE' ? nickname === '터비 탐험가' : false,
    playerName: nickname,
    completedEvents: [],
    objectives: {},
    storyNubi: null,
    storyNubiMissing: false,
    openingRequired: !done(), // v15: 신규·기존 모두 필수
    openingAvailable: !done(),
    openingStarted: checkpoint !== 'OPENING_NOT_STARTED',
    origin: opts.origin,
    stages: STAGES.map(([stageCode, title], i) => ({
      stageCode,
      order: i + 1,
      title,
      state: done() && i === 0 ? 'current' : 'locked',
      canEnter: done() && i === 0,
      canProgress: done() && i === 0,
      lockedReason: !done() ? 'OPENING_REQUIRED' : i === 0 ? null : 'STAGE_LOCKED',
      hint: !done() ? '먼저 누비와 이야기를 마쳐 주세요.' : i === 0 ? null : `${STAGES[i - 1][1]}의 이야기를 마치면 열립니다`,
      legacyTargetCode: null,
    })),
  });

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(opts.baseUrl)) return realFetch(input, init);
    const path = url.slice(opts.baseUrl.length);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    await new Promise((r) => setTimeout(r, 120));
    if (path === '/player/identify') return json(200, { playerId: '1', nickname, tareBalance: 100, turbys: turbys(), sessionToken: 'preview-session-token' });
    if (path === '/shop') return json(200, []);
    if (path === '/player/me/items') return json(200, []);
    if (path === '/player/me/story') return json(200, story());
    if (path === '/player/me/story/dialogue/opening') return json(200, opening);
    const ev = path.match(/^\/player\/me\/story\/events\/([a-z_]+)\/complete$/);
    if (ev) {
      if (NEXT[ev[1]]) checkpoint = NEXT[ev[1]];
      if (ev[1] === 'story_nubi_granted') nubiGranted = true;
      return json(200, { eventId: ev[1], alreadyCompleted: false, grants: [], consumed: [], story: story() });
    }
    if (path === '/player/me/profile/name') {
      nickname = String(body.name ?? '').trim();
      checkpoint = 'OPENING_NAME_SAVED';
      return json(200, { eventId: 'opening_name_saved', alreadyCompleted: false, grants: [], consumed: [], story: story() });
    }
    return json(404, { code: 'PREVIEW_NOT_MOCKED', message: `미리보기에서 흉내 내지 않는 경로: ${path}` });
  };
}
