import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { fetchSession } from '../account/accountClient';
import { addKirbies, adjustGold, getPlayer, listCharacters, listLogs, removeKirby, searchPlayers } from './adminClient';
import type { AdminCharacter, AdminLog, AdminPlayerDetail, AdminPlayerRow } from './adminClient';
import { SpawnTab } from './SpawnTab';
import { MergeDefenseAdminTab } from './MergeDefenseAdminTab';
import './Admin.css';

type Tab = 'players' | 'spawn' | 'merge-defense' | 'logs';

const ACTION_LABELS: Record<string, string> = {
  'kirby.instance.add': '커비 추가',
  'kirby.instance.remove': '커비 삭제',
  'kirby.gold.set': '골드 설정',
  'kirby.gold.add': '골드 가감',
  'kirby.spawn.update': '스폿 설정',
  'merge_defense.profile.update': '머지 디펜스 프로필 설정',
};

function errorText(err: unknown) {
  return err instanceof Error ? err.message : '요청에 실패했습니다';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { hour12: false });
}

// 관리자 백오피스(2026-09-29, docs/dev/admin_backoffice.md) — 커비 훔치기 유저 검색·보유 커비 추가/삭제·골드 조정·조작 로그
export function AdminPage({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('players');

  useEffect(() => {
    void fetchSession().then((s) => setAllowed(!!s?.isAdmin));
  }, []);

  return (
    <div className="admin">
      <div className="admin-header">
        <button type="button" className="admin-back" onClick={onBack}>
          ← 게임 허브로
        </button>
        <h1>관리자</h1>
      </div>

      {allowed === null && <p className="admin-muted">권한 확인 중…</p>}
      {allowed === false && <p className="admin-error">관리자 계정으로 로그인해야 합니다.</p>}
      {allowed && (
        <>
          <div className="admin-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'players'} className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
              커비 훔치기 유저
            </button>
            <button type="button" role="tab" aria-selected={tab === 'spawn'} className={tab === 'spawn' ? 'active' : ''} onClick={() => setTab('spawn')}>
              스폿 확률·이벤트
            </button>
            <button type="button" role="tab" aria-selected={tab === 'merge-defense'} className={tab === 'merge-defense' ? 'active' : ''} onClick={() => setTab('merge-defense')}>
              광고게임 &gt; 머지 디펜스
            </button>
            <button type="button" role="tab" aria-selected={tab === 'logs'} className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
              조작 로그
            </button>
          </div>
          {tab === 'players' && <PlayersTab />}
          {tab === 'spawn' && <SpawnTab />}
          {tab === 'merge-defense' && <MergeDefenseAdminTab />}
          {tab === 'logs' && <LogsTab />}
        </>
      )}
    </div>
  );
}

function PlayersTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminPlayerRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    try {
      setRows(await searchPlayers(query));
    } catch (err) {
      setError(errorText(err));
    }
  };

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (selectedId) {
    return (
      <PlayerDetail
        playerId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void search();
        }}
      />
    );
  }

  return (
    <>
      <form className="admin-search" onSubmit={search}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="플레이어 id · 게임 닉네임 · 허브 아이디/닉네임" />
        <button type="submit">검색</button>
      </form>
      {error && <p className="admin-error">{error}</p>}
      {rows && rows.length === 0 && <p className="admin-muted">검색 결과가 없습니다.</p>}
      {rows && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>id</th>
                <th>게임 닉네임</th>
                <th>허브 계정</th>
                <th className="num">골드</th>
                <th className="num">커비</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId} className="clickable" onClick={() => setSelectedId(r.playerId)}>
                  <td>{r.playerId}</td>
                  <td>{r.nickname}</td>
                  <td>{r.loginId ? `${r.accountNickname} (${r.loginId})` : <span className="admin-muted">게스트</span>}</td>
                  <td className="num">{r.gold.toLocaleString()}</td>
                  <td className="num">{r.kirbyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length >= 50 && <p className="admin-muted">최대 50명까지 표시합니다. 검색어로 좁혀 주세요.</p>}
    </>
  );
}

function PlayerDetail({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [player, setPlayer] = useState<AdminPlayerDetail | null>(null);
  const [characters, setCharacters] = useState<AdminCharacter[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [goldMode, setGoldMode] = useState<'set' | 'add'>('add');
  const [goldAmount, setGoldAmount] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [count, setCount] = useState('1');

  useEffect(() => {
    Promise.all([getPlayer(playerId), listCharacters()])
      .then(([p, c]) => {
        setPlayer(p);
        setCharacters(c);
        if (c[0]) setCharacterId(String(c[0].characterId));
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [playerId]);

  const run = async (action: () => Promise<AdminPlayerDetail>, done: string) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setPlayer(await action());
      setNotice(done);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitGold = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(goldAmount);
    if (!Number.isInteger(amount)) return setError('금액은 정수로 입력하세요');
    if (!player) return;
    const preview = goldMode === 'set' ? `${amount.toLocaleString()}로 설정` : `${amount >= 0 ? '+' : ''}${amount.toLocaleString()}`;
    if (!window.confirm(`${player.nickname}(#${player.playerId})의 골드를 ${preview}합니다. 진행할까요?`)) return;
    void run(() => adjustGold(playerId, goldMode, amount), '골드를 변경했습니다').then((ok) => ok && setGoldAmount(''));
  };

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(count);
    const ch = characters.find((c) => String(c.characterId) === characterId);
    if (!ch || !Number.isInteger(n) || n < 1 || n > 20) return setError('캐릭터와 수량(1~20)을 확인하세요');
    if (!window.confirm(`[${ch.name}] ${n}개를 추가합니다. 진행할까요?`)) return;
    void run(() => addKirbies(playerId, ch.characterId, n), `[${ch.name}] ${n}개를 추가했습니다`);
  };

  const remove = (instanceId: string, name: string) => {
    if (!window.confirm(`[${name}] (#${instanceId})를 삭제합니다. 되돌릴 수 없습니다. 진행할까요?`)) return;
    void run(() => removeKirby(playerId, instanceId), `[${name}]를 삭제했습니다`);
  };

  return (
    <div className="admin-detail">
      <button type="button" className="admin-link" onClick={onBack}>
        ← 검색 결과로
      </button>
      {error && <p className="admin-error">{error}</p>}
      {!player && !error && <p className="admin-muted">불러오는 중…</p>}
      {player && (
        <>
          <dl className="admin-summary">
            <div>
              <dt>플레이어</dt>
              <dd>
                #{player.playerId} {player.nickname}
              </dd>
            </div>
            <div>
              <dt>허브 계정</dt>
              <dd>{player.account ? `${player.account.nickname} (${player.account.loginId})` : '게스트'}</dd>
            </div>
            <div>
              <dt>골드</dt>
              <dd>
                <strong>{player.gold.toLocaleString()}</strong>
              </dd>
            </div>
            <div>
              <dt>보유 커비</dt>
              <dd>{player.instances.length}개</dd>
            </div>
          </dl>
          <p className="admin-muted">게임에 접속 중인 유저는 새로고침하거나 다음 행동을 할 때 바뀐 값이 보입니다.</p>
          {notice && <p className="admin-notice">{notice}</p>}

          <form className="admin-form" onSubmit={submitGold}>
            <h2>골드 조정</h2>
            <select value={goldMode} onChange={(e) => setGoldMode(e.target.value as 'set' | 'add')}>
              <option value="add">더하기/빼기</option>
              <option value="set">값으로 설정</option>
            </select>
            <input inputMode="numeric" value={goldAmount} onChange={(e) => setGoldAmount(e.target.value)} placeholder={goldMode === 'add' ? '예: 500 또는 -200' : '예: 1000'} required />
            <button type="submit" disabled={busy}>
              적용
            </button>
          </form>

          <form className="admin-form" onSubmit={submitAdd}>
            <h2>커비 추가</h2>
            <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              {characters.map((c) => (
                <option key={c.characterId} value={c.characterId}>
                  #{c.characterId} {c.name} · {c.grade}
                </option>
              ))}
            </select>
            <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} className="admin-count" />
            <button type="submit" disabled={busy}>
              추가
            </button>
          </form>

          <h2 className="admin-subtitle">보유 커비</h2>
          {player.instances.length === 0 ? (
            <p className="admin-muted">보유한 커비가 없습니다.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>instance</th>
                    <th>캐릭터</th>
                    <th>등급</th>
                    <th className="num">판매가</th>
                    <th>상태</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {player.instances.map((i) => (
                    <tr key={i.instanceId}>
                      <td>{i.instanceId}</td>
                      <td>
                        #{i.characterId} {i.name}
                      </td>
                      <td>{i.grade}</td>
                      <td className="num">{i.sellPrice.toLocaleString()}</td>
                      <td>{i.status === 'idle' ? '보관' : <span className="admin-warn">도둑맞는 중</span>}</td>
                      <td>
                        <button type="button" className="admin-danger" disabled={busy || i.status !== 'idle'} onClick={() => remove(i.instanceId, i.name)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function describe(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : String(v)}`)
    .join(' · ');
}

function LogsTab() {
  const [targetId, setTargetId] = useState('');
  const [logs, setLogs] = useState<AdminLog[] | null>(null);
  const [error, setError] = useState('');

  const load = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    try {
      setLogs(await listLogs(targetId.trim() || undefined));
    } catch (err) {
      setError(errorText(err));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <form className="admin-search" onSubmit={load}>
        <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="대상 id — 플레이어 또는 캐릭터 (비우면 전체)" />
        <button type="submit">조회</button>
      </form>
      {error && <p className="admin-error">{error}</p>}
      {logs && logs.length === 0 && <p className="admin-muted">기록이 없습니다.</p>}
      {logs && logs.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>관리자</th>
                <th>작업</th>
                <th>대상</th>
                <th>변경 전</th>
                <th>변경 후</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{formatDate(l.createdAt)}</td>
                  <td>{l.admin}</td>
                  <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td>
                    {l.targetType === 'kirby_character' ? '캐릭터 ' : l.targetType === 'account' ? '계정 ' : '플레이어 '}#{l.targetId}
                  </td>
                  <td className="admin-json">{describe(l.before)}</td>
                  <td className="admin-json">{describe(l.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
