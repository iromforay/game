// 그리기 순서 비교(순수 계산 — test/screenLayouts.test.ts). ui/inputReady.ts가 "겹친 입력 대상 중 맨 위"를 고를 때 쓴다.
// 경로 = [최상위 표시 목록에서의 위치, 컨테이너 안에서의 위치, …]. 뒤에 그려질수록 값이 크고, 화면에서는 위에 있다.
export function compareDrawPaths(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i];
  return b.length - a.length; // 같은 줄기면 더 안쪽(자식)이 위
}
