// Local-only gameplay event logging (IndexedDB). Used to analyze difficulty
// and bugs after the fact - not a telemetry pipeline. If a backend log sink
// is ever needed (e.g. accumulating logs in production for a while), this
// API is the natural place to add a periodic upload without changing call
// sites in the games themselves.
//
// Configured via env vars (see .env.example in each app) rather than any
// in-game UI:
//   VITE_GAME_LOG_ENABLED       'false' disables logging entirely (default: enabled)
//   VITE_GAME_LOG_RETENTION_DAYS  prune entries older than this on load (default: keep all)
//
// To pull logs out for analysis, use the browser devtools console:
//   await window.gameLogs.export()  // JSON string
//   await window.gameLogs.clear()

const DB_NAME = 'game-logs';
const STORE_NAME = 'events';
const DB_VERSION = 1;

const LOG_ENABLED = import.meta.env.VITE_GAME_LOG_ENABLED !== 'false';
const RETENTION_DAYS = Number(import.meta.env.VITE_GAME_LOG_RETENTION_DAYS ?? '');

export interface LogEntry {
  id?: number;
  ts: number; // Date.now()
  game: string; // 'tower-defense' | 'offense-tower' | ...
  type: string; // event name, e.g. 'hero_spawn', 'tower_destroyed'
  data?: Record<string, unknown>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (Number.isFinite(RETENTION_DAYS) && RETENTION_DAYS > 0) {
    dbPromise.then(() => pruneLogsOlderThan(RETENTION_DAYS * 86_400_000)).catch(() => {});
  }
  return dbPromise;
}

/** Fire-and-forget: failures (e.g. private browsing) are swallowed since logging must never break gameplay. */
export function logEvent(game: string, type: string, data?: Record<string, unknown>): void {
  if (!LOG_ENABLED) return;
  const entry: LogEntry = { ts: Date.now(), game, type, data };
  openDb()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add(entry);
    })
    .catch(() => {});
}

export function getAllLogs(): Promise<LogEntry[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result as LogEntry[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function clearLogs(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** Retention control - e.g. call periodically to only keep the last N days of logs. */
export function pruneLogsOlderThan(maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const index = tx.objectStore(STORE_NAME).index('ts');
        const range = IDBKeyRange.upperBound(cutoff);
        index.openCursor(range).onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function exportLogsAsJson(): Promise<string> {
  const logs = await getAllLogs();
  return JSON.stringify(logs, null, 2);
}

declare global {
  interface Window {
    gameLogs?: { all: typeof getAllLogs; export: typeof exportLogsAsJson; clear: typeof clearLogs };
  }
}

if (typeof window !== 'undefined') {
  window.gameLogs = { all: getAllLogs, export: exportLogsAsJson, clear: clearLogs };
}
