// Local record of which rounds have been cleared. Clearing never locks a
// round - it can always be replayed - this just drives the checkmark shown
// in the lounge's round list.

const KEY = 'offense-tower-cleared-rounds';

function readSet(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

export function getClearedRounds(): number[] {
  return [...readSet()];
}

export function isRoundCleared(roundId: number): boolean {
  return readSet().has(roundId);
}

export function markRoundCleared(roundId: number): void {
  const set = readSet();
  set.add(roundId);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Ignore (e.g. private browsing) - just won't persist this session.
  }
}
