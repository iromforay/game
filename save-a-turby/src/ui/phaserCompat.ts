// Phaser 내부 구조에 기대는 코드(ui/inputReady.ts)의 호환 조건(순수 — test/screenLayouts.test.ts가 검사).
//
// 확인한 버전: Phaser 3.90.0 (package.json에 범위 표기 없이 고정, lockfile·설치본과 일치해야 테스트가 통과한다).
// 버전을 올릴 때: ① 아래 VERIFIED_PHASER_VERSION과 package.json을 함께 바꾸고 ② node_modules/phaser/src/input/InputPlugin.js의
// preUpdate·update·sortGameObjects가 같은 구조인지 읽어 확인한 뒤 ③ BE에서 `npm run test:e2e`(특히 input.e2e.ts)를 20회 돌린다.
export const VERIFIED_PHASER_VERSION = '3.90.0';

// inputReady가 쓰는 InputPlugin 내부 필드·메서드. 하나라도 예상과 다르면 패치를 설치하지 않는다(조용히 잘못 동작하지 않게)
export function inputInternalsProblem(io: unknown): string | null {
  if (!io || typeof io !== 'object') return 'InputPlugin이 없습니다';
  const o = io as Record<string, unknown>;
  for (const key of ['_list', '_pendingInsertion', '_pendingRemoval']) if (!Array.isArray(o[key])) return `InputPlugin.${key}이(가) 배열이 아닙니다`;
  for (const key of ['clear', 'update', 'sortGameObjects']) if (typeof o[key] !== 'function') return `InputPlugin.${key}이(가) 함수가 아닙니다`;
  return null;
}
