import { useEffect, useMemo, useState } from 'react';
import { listSpawnSettings, updateSpawnSettings } from './adminClient';
import type { AdminSpawnChange, AdminSpawnSetting } from './adminClient';

// 스폿 설정(2026-09-29, docs/dev/admin_backoffice.md) — 캐릭터별 가중치·등장 여부·등장 기간.
// 확률 미리보기는 서버 규칙(BE/src/kirby/spawnRules.ts)과 같다: 켜짐 + 가중치 > 0 + 기간 안.
interface Draft {
  weight: string;
  enabled: boolean;
  starts: string; // datetime-local 값(브라우저 현지 시각), 비우면 제한 없음
  ends: string;
}

type SpawnStatus = 'active' | 'off' | 'scheduled' | 'ended';

const STATUS_LABELS: Record<SpawnStatus, string> = {
  active: '등장 중',
  off: '꺼짐',
  scheduled: '시작 전',
  ended: '기간 종료',
};

function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function toDraft(s: AdminSpawnSetting): Draft {
  return { weight: String(s.weight), enabled: s.spawnEnabled, starts: toLocalInput(s.spawnStartsAt), ends: toLocalInput(s.spawnEndsAt) };
}

function statusOf(d: Draft, now: number): SpawnStatus {
  const weight = Number(d.weight);
  if (!d.enabled || !(weight > 0)) return 'off';
  if (d.starts && now < new Date(d.starts).getTime()) return 'scheduled';
  if (d.ends && now >= new Date(d.ends).getTime()) return 'ended';
  return 'active';
}

function formatPercent(p: number) {
  if (p === 0) return '0%';
  return p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`;
}

export function SpawnTab() {
  const [settings, setSettings] = useState<AdminSpawnSetting[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (list: AdminSpawnSetting[]) => {
    setSettings(list);
    setDrafts(Object.fromEntries(list.map((s) => [s.characterId, toDraft(s)])));
  };

  useEffect(() => {
    listSpawnSettings()
      .then(apply)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '불러오지 못했습니다'));
  }, []);

  const now = Date.now();
  const preview = useMemo(() => {
    if (!settings) return { rows: [], grades: [] as { grade: string; probability: number }[], activeCount: 0 };
    const rows = settings.map((s) => {
      const d = drafts[s.characterId] ?? toDraft(s);
      return { s, d, status: statusOf(d, now) };
    });
    const total = rows.reduce((sum, r) => sum + (r.status === 'active' ? Number(r.d.weight) : 0), 0);
    const withP = rows.map((r) => ({ ...r, probability: r.status === 'active' && total > 0 ? (Number(r.d.weight) / total) * 100 : 0 }));
    const gradeMap = new Map<string, number>();
    for (const r of withP) gradeMap.set(r.s.grade, (gradeMap.get(r.s.grade) ?? 0) + r.probability);
    return {
      rows: withP,
      grades: [...gradeMap.entries()].map(([grade, probability]) => ({ grade, probability })),
      activeCount: withP.filter((r) => r.status === 'active').length,
    };
    // now는 렌더마다 바뀌므로 의존성에서 제외(분 단위 기간이라 저장·편집 시점 기준이면 충분)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, drafts]);

  const changes: AdminSpawnChange[] = useMemo(() => {
    if (!settings) return [];
    const list: AdminSpawnChange[] = [];
    for (const s of settings) {
      const d = drafts[s.characterId];
      if (!d) continue;
      const base = toDraft(s);
      const change: AdminSpawnChange = { characterId: s.characterId };
      if (d.weight !== base.weight) change.weight = Number(d.weight);
      if (d.enabled !== base.enabled) change.spawnEnabled = d.enabled;
      if (d.starts !== base.starts) change.spawnStartsAt = fromLocalInput(d.starts);
      if (d.ends !== base.ends) change.spawnEndsAt = fromLocalInput(d.ends);
      if (Object.keys(change).length > 1) list.push(change);
    }
    return list;
  }, [settings, drafts]);

  const edit = (id: number, patch: Partial<Draft>) => {
    setNotice('');
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const save = async () => {
    if (busy || changes.length === 0) return;
    const invalid = changes.find((c) => c.weight !== undefined && (!Number.isInteger(c.weight) || c.weight < 0));
    if (invalid) return setError('가중치는 0 이상의 정수로 입력하세요');
    if (preview.activeCount === 0) return setError('등장 중인 캐릭터가 하나도 없게 됩니다. 최소 한 종은 등장해야 합니다.');
    if (!window.confirm(`${changes.length}종의 스폿 설정을 저장합니다. 다음 좌대부터 바로 적용됩니다. 진행할까요?`)) return;
    setBusy(true);
    setError('');
    try {
      apply(await updateSpawnSettings(changes));
      setNotice(`${changes.length}종의 설정을 저장했습니다`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  if (error && !settings) return <p className="admin-error">{error}</p>;
  if (!settings) return <p className="admin-muted">불러오는 중…</p>;

  return (
    <>
      <p className="admin-muted">
        확률 = 가중치 ÷ 지금 등장 중인 캐릭터 가중치 합. 끄거나 기간 밖인 캐릭터는 좌대에 나오지 않고, 이미 보유한 커비는 그대로입니다. 기간은 이 브라우저의 현지 시각입니다.
      </p>
      <div className="admin-grade-summary">
        {preview.grades.map((g) => (
          <span key={g.grade}>
            {g.grade} <strong>{formatPercent(g.probability)}</strong>
          </span>
        ))}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-spawn-table">
          <thead>
            <tr>
              <th>캐릭터</th>
              <th>등급</th>
              <th>등장</th>
              <th className="num">가중치</th>
              <th className="num">확률</th>
              <th>시작</th>
              <th>종료</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map(({ s, d, status, probability }) => {
              const dirty = changes.some((c) => c.characterId === s.characterId);
              return (
                <tr key={s.characterId} className={dirty ? 'dirty' : ''}>
                  <td>
                    #{s.characterId} {s.name}
                  </td>
                  <td>{s.grade}</td>
                  <td>
                    <input type="checkbox" checked={d.enabled} onChange={(e) => edit(s.characterId, { enabled: e.target.checked })} aria-label={`${s.name} 등장`} />
                  </td>
                  <td className="num">
                    <input className="admin-weight" type="number" min={0} value={d.weight} onChange={(e) => edit(s.characterId, { weight: e.target.value })} />
                  </td>
                  <td className="num">{formatPercent(probability)}</td>
                  <td>
                    <input type="datetime-local" value={d.starts} onChange={(e) => edit(s.characterId, { starts: e.target.value })} />
                  </td>
                  <td>
                    <input type="datetime-local" value={d.ends} onChange={(e) => edit(s.characterId, { ends: e.target.value })} />
                  </td>
                  <td>
                    <span className={`admin-status admin-status-${status}`}>{STATUS_LABELS[status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-notice">{notice}</p>}
      <div className="admin-savebar">
        <button type="button" onClick={() => apply(settings)} disabled={busy || changes.length === 0}>
          되돌리기
        </button>
        <button type="button" className="primary" onClick={save} disabled={busy || changes.length === 0}>
          {busy ? '저장 중…' : `변경사항 저장 (${changes.length})`}
        </button>
      </div>
    </>
  );
}
