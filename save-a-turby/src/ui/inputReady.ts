// 새로 만든 버튼·카드가 "만든 즉시" 눌리게 한다(10-01 v1 §1 — 한 번의 입력이 빠지지 않게).
//
// 원인: Phaser는 setInteractive로 등록한 대상을 대기 목록에 넣었다가 다음 프레임의 preUpdate에서야 입력 판정 목록에 합친다.
// 그래서 화면을 다시 그린(버튼을 파괴하고 새로 만든) 직후, 다음 프레임이 오기 전에 들어온 탭은 새 버튼이 아직 판정 대상이
// 아니어서 조용히 사라지거나 뒤에 깔린 배경에 맞는다. 응답 직후·페이지 전환 직후·턴 전환 직후의 탭이 그 경우다.
//
// 또 하나: Phaser는 겹친 대상 중 맨 위를 "직전 프레임에 실제로 그려진 목록(camera.renderList)" 순서로 고른다. 아직 한 번도
// 그려지지 않은 새 대상은 모두 순위가 같아져, 먼저 만든 배경(창 뒤판)이 탭을 가져간다.
//
// 해결: 입력 이벤트를 처리하기 직전에 대기 목록을 먼저 반영하고(Phaser preUpdate와 같은 처리), 맨 위 판정은 그려진 적이
// 있는지와 무관한 실제 그리기 순서(표시 목록의 깊이 순서 → 컨테이너 안 순서)로 한다. 새 UI가 상호작용 가능해지는
// 시점이 이 한곳에서 정해지므로, 화면마다 지연·재클릭 같은 우회를 두지 않는다. 파괴된 대상은 같은 시점에 목록에서 빠진다.
import Phaser from 'phaser';

type InputInternals = {
  _list: Phaser.GameObjects.GameObject[];
  _pendingInsertion: Phaser.GameObjects.GameObject[];
  _pendingRemoval: Phaser.GameObjects.GameObject[];
  clear(gameObject: Phaser.GameObjects.GameObject, skipQueue?: boolean): unknown;
  update(type: number, pointers: Phaser.Input.Pointer[]): boolean;
  sortGameObjects(gameObjects: Phaser.GameObjects.GameObject[], pointer: Phaser.Input.Pointer): Phaser.GameObjects.GameObject[];
  __immediate?: boolean;
};

// 그리기 순서 경로: 최상위 표시 목록에서의 위치 → 컨테이너 안에서의 위치 …(뒤에 그려질수록 큰 값 = 위)
function drawPath(o: Phaser.GameObjects.GameObject, root: Phaser.GameObjects.GameObject[]): number[] {
  const path: number[] = [];
  let node = o as Phaser.GameObjects.GameObject & { parentContainer?: Phaser.GameObjects.Container | null };
  while (node.parentContainer) {
    path.unshift(node.parentContainer.list.indexOf(node));
    node = node.parentContainer as typeof node;
  }
  path.unshift(root.indexOf(node));
  return path;
}

// 위에 그려지는 것이 앞에 오도록 정렬(순수 비교 — 테스트 대상)
export function compareDrawPaths(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i];
  return b.length - a.length; // 같은 줄기면 더 안쪽(자식)이 위
}

// 대기 중인 제거·추가를 입력 판정 목록에 반영(Phaser InputPlugin.preUpdate의 목록 처리와 동일)
export function commitPendingInput(input: Phaser.Input.InputPlugin) {
  const io = input as unknown as InputInternals;
  const remove = io._pendingRemoval;
  const insert = io._pendingInsertion;
  if (!remove || !insert || (remove.length === 0 && insert.length === 0)) return;
  const current = io._list;
  for (const gameObject of remove) {
    const index = current.indexOf(gameObject);
    if (index > -1) {
      current.splice(index, 1);
      io.clear(gameObject, true);
    }
  }
  remove.length = 0;
  io._list = current.concat(insert.splice(0));
}

// 게임의 모든 씬에 한 번만 설치한다(씬 재시작·wake·resize로 다시 불려도 중복 설치되지 않음)
export function installImmediateInput(game: Phaser.Game) {
  const patch = () => {
    for (const scene of game.scene.scenes) {
      const input = (scene.sys as unknown as { input?: Phaser.Input.InputPlugin }).input;
      const io = input as unknown as InputInternals | undefined;
      if (!io || io.__immediate) continue;
      io.__immediate = true;
      const update = io.update.bind(io);
      io.update = (type, pointers) => {
        commitPendingInput(input!);
        return update(type, pointers);
      };
      io.sortGameObjects = (gameObjects) => {
        if (gameObjects.length < 2) return gameObjects;
        scene.sys.displayList.depthSort(); // 깊이 바뀐 것이 있으면 그리기 전과 같은 순서로 맞춘다
        const root = scene.sys.displayList.list;
        const paths = new Map(gameObjects.map((o) => [o, drawPath(o, root)]));
        return gameObjects.sort((x, y) => compareDrawPaths(paths.get(x)!, paths.get(y)!));
      };
    }
  };
  if (game.isBooted && game.scene.scenes.length > 0) patch();
  game.events.once(Phaser.Core.Events.READY, patch);
}
