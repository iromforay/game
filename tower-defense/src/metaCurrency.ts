// Persistent meta-progression currency, shared across games/runs (localStorage).
// Earned on stage clear; spent later in the lounge on hero upgrades / items
// (not built yet - this just gives that future shop something to read from).

const KEY = 'meta-coins';

export function getCoins(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Returns the new total. */
export function addCoins(amount: number): number {
  const next = getCoins() + amount;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // Ignore (e.g. private browsing) - coins just won't persist this session.
  }
  return next;
}
