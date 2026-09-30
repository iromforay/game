// 개발용 전체 게임 흐름 미리보기 — 가짜 BE(fakeBackend)를 먼저 설치한 뒤 실제 게임(mountGame)을 띄운다.
// ?origin=legacy_backfill|new  &checkpoint=OPENING_NOT_STARTED|...  &nickname=...
// 기기 식별자는 미리보기 전용(dev-preview-*)으로 두어 실제 계정 토큰·캐시와 섞이지 않게 한다.
import { installFakeBackend } from './fakeBackend';

const params = new URLSearchParams(location.search);
const origin = params.get('origin') === 'new' ? 'new' : 'legacy_backfill';
installFakeBackend({
  origin,
  nickname: params.get('nickname') ?? (origin === 'new' ? '터비 탐험가' : '옛날유저'),
  checkpoint: params.get('checkpoint') ?? undefined,
  baseUrl: import.meta.env.VITE_TURBY_SERVER_URL ?? 'http://localhost:3002',
});
if (!params.get('device')) {
  params.set('device', `preview-${origin}`);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

const { mountGame } = await import('../src/game');
const game = await mountGame('app');
(window as unknown as { __game?: unknown }).__game = game;
