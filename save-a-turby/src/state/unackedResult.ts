// 10-06 v4 §1: 서버가 "확인하지 않은 전투 결과가 있어요"(UNACKNOWLEDGED_BATTLE_RESULT)로 새 활동을 거부했을 때의 복원 흐름.
// 새 활동을 계속 시도하지 않고 그 결과 화면으로 간다. 결과 조회가 실패하면 마을로 가서 복원 안내(deferredRestore)를 유지한다.
export const UNACKNOWLEDGED_RESULT_CODE = 'UNACKNOWLEDGED_BATTLE_RESULT';

export const isUnackedResultError = (err: unknown): err is { code: string; battleId: string | null; message: string } =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNACKNOWLEDGED_RESULT_CODE;

export type UnackedPorts = {
  fetchSnapshot: (battleId: string) => Promise<unknown>; // 결과 조회(실패할 수 있다)
  showResult: (snapshot: never) => void; // 결과 화면으로 이동
  fallbackToVillage: () => void; // 조회 실패 — 마을에서 복원 안내를 다시 보인다
  isStale: () => boolean; // 기다리는 사이 화면이 바뀌었는가(오래된 응답이 새 화면을 덮지 않게)
};

// 처리했으면 true(호출자는 더 진행하지 않는다)
export async function recoverUnackedResult(err: unknown, ports: UnackedPorts): Promise<boolean> {
  if (!isUnackedResultError(err)) return false;
  const id = err.battleId;
  if (!id) {
    if (!ports.isStale()) ports.fallbackToVillage();
    return true;
  }
  let snapshot: unknown = null;
  try {
    snapshot = await ports.fetchSnapshot(id);
  } catch {
    snapshot = null;
  }
  if (ports.isStale()) return true;
  if (snapshot) ports.showResult(snapshot as never);
  else ports.fallbackToVillage();
  return true;
}
