// 개발 전용 캡처·조작 도우미(배포 번들 제외). 실제 게임 클라이언트(개발 서버, window.__game) 또는 dev 미리보기에서
// `await import('/dev/captureHelper.ts')`로 불러 window.__dev를 설치한다.
//   cap(name): 게임 캔버스를 실제 표시 크기로 저장(로컬 캡처 수신기 127.0.0.1:5199)
//   tap(x, y): 캔버스 좌표(1280×720)에서 가장 위에 있는 입력 대상에 pointerdown — 뷰포트 에뮬레이션에서 화면 좌표가 어긋날 때용
//   keepAlive(): 창이 숨겨져 rAF가 멈춰도 게임 루프가 돌도록 Phaser 루프를 타이머 방식으로 다시 시작
//   active(): 실행 중인 씬 키
import type Phaser from 'phaser';

const game = () => (window as unknown as { __game: Phaser.Game }).__game;

function cap(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const g = game();
    g.renderer.snapshot((img) => {
      const w = Math.round(g.scale.displaySize.width);
      const h = Math.round(g.scale.displaySize.height);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img as HTMLImageElement, 0, 0, w, h);
      fetch('http://127.0.0.1:5199/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${w}x${h}_${name}.jpg`, dataUrl: c.toDataURL('image/jpeg', 0.9) }) })
        .then((r) => r.json())
        .then((j: { file: string }) => resolve(j.file), reject);
    }, 'image/png');
  });
}

function tap(x: number, y: number): string | null {
  const g = game();
  const hits: { o: Phaser.GameObjects.GameObject; depth: number; order: number }[] = [];
  let order = 0;
  for (const scene of g.scene.getScenes(true)) {
    const walk = (list: Phaser.GameObjects.GameObject[], base: number) => {
      for (const o of list) {
        order++;
        const any = o as unknown as { input?: { enabled: boolean }; getBounds?: () => Phaser.Geom.Rectangle; depth?: number; visible?: boolean; list?: Phaser.GameObjects.GameObject[] };
        if (any.visible === false) continue;
        if (any.list) walk(any.list, base + (any.depth ?? 0));
        if (any.input?.enabled && any.getBounds?.().contains(x, y)) hits.push({ o, depth: base + (any.depth ?? 0), order });
      }
    };
    walk(scene.children.list, g.scene.getIndex(scene) * 100000);
  }
  hits.sort((a, b) => b.depth - a.depth || b.order - a.order);
  const top = hits[0]?.o;
  top?.emit('pointerdown');
  return top ? ((top as unknown as { text?: string }).text ?? top.type) : null;
}

function keepAlive() {
  const loop = game().loop as unknown as { forceSetTimeOut: boolean; stop(): void; start(cb: unknown): void; callback: unknown };
  if (loop.forceSetTimeOut) return 'already';
  const cb = loop.callback;
  loop.stop();
  loop.forceSetTimeOut = true;
  loop.start(cb);
  return 'timer loop';
}

const active = () => game().scene.getScenes(true).map((s) => s.scene.key);

(window as unknown as { __dev?: unknown }).__dev = { cap, tap, keepAlive, active };
export {};
