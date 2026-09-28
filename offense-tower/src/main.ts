import { mountGame } from './game';

void mountGame('app').then((game) => {
  // 개발 서버 단독 실행 시에만 콘솔 디버깅용으로 노출(허브는 mountGame을 직접 쓰므로 영향 없음)
  if (import.meta.env.DEV) (window as unknown as { __game?: typeof game }).__game = game;
});
