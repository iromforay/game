import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  deleteMyRoomDungeonProfile,
  getMyRoomDungeonProfile,
  searchMyRoomDungeonAccounts,
  updateMyRoomDungeonProfile,
} from './adminClient';
import type { AdminMyRoomDungeonProfile, AdminMyRoomDungeonUpdate } from './adminClient';

const RESOURCE_LABELS: Record<string, string> = {
  paper: '종이', tape: '테이프', screw: '작은 나사', battery: '건전지', plastic: '플라스틱',
  clockwork: '태엽 부품', motor: '소형 모터', cloth: '천', metal: '금속 조각', wire: '전선',
  circuit: '회로', dust: '먼지 결정', mystery: '수수께끼 부품', 'room-core': '방의 코어',
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '요청에 실패했습니다';
}

export function MyRoomDungeonAdminTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminMyRoomDungeonProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    setError('');
    try { setRows(await searchMyRoomDungeonAccounts(query)); }
    catch (err) { setError(errorText(err)); }
  };

  useEffect(() => { void search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (selectedId) return <DungeonDetail accountId={selectedId} onBack={() => { setSelectedId(null); void search(); }} />;

  return (
    <>
      <p className="admin-section-path">광고게임 &gt; 내방이 던전</p>
      <form className="admin-search" onSubmit={search}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계정 id · 로그인 아이디 · 닉네임" />
        <button type="submit">검색</button>
      </form>
      {error && <p className="admin-error">{error}</p>}
      {rows && rows.length === 0 && <p className="admin-muted">검색 결과가 없습니다.</p>}
      {rows && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>계정</th><th>진행 데이터</th><th className="num">자원</th><th className="num">봇</th><th className="num">무기</th><th className="num">클리어 구역</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.accountId} className="clickable" onClick={() => setSelectedId(row.accountId)}>
                <td><strong>{row.nickname}</strong><br /><span className="admin-muted">#{row.accountId} · {row.loginId}</span></td>
                <td>{row.profileExists ? '있음' : <span className="admin-muted">미생성</span>}</td>
                <td className="num">{Object.values(row.inventory).reduce((sum, value) => sum + value, 0).toLocaleString()}</td>
                <td className="num">{row.craftedBots.toLocaleString()}</td>
                <td className="num">{row.craftedSwords.toLocaleString()}</td>
                <td className="num">{row.clearedZones.length}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DungeonDetail({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const [profile, setProfile] = useState<AdminMyRoomDungeonProfile | null>(null);
  const [draft, setDraft] = useState<AdminMyRoomDungeonUpdate | null>(null);
  const [assignmentsText, setAssignmentsText] = useState('{}');
  const [newResource, setNewResource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const apply = (next: AdminMyRoomDungeonProfile) => {
    setProfile(next);
    setDraft({ inventory: { ...next.inventory }, discovered: [...next.discovered], craftedBots: next.craftedBots, craftedSwords: next.craftedSwords, clearedZones: [...next.clearedZones], robotAssignments: next.robotAssignments });
    setAssignmentsText(JSON.stringify(next.robotAssignments, null, 2));
  };
  useEffect(() => { getMyRoomDungeonProfile(accountId).then(apply).catch((err) => setError(errorText(err))); }, [accountId]);

  const changeResource = (code: string, value: number) => setDraft((current) => current ? { ...current, inventory: { ...current.inventory, [code]: Math.max(0, value || 0) } } : current);
  const removeResource = (code: string) => setDraft((current) => {
    if (!current) return current;
    const inventory = { ...current.inventory }; delete inventory[code];
    return { ...current, inventory, discovered: current.discovered.filter((item) => item !== code) };
  });
  const addResource = () => {
    const code = newResource.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/i.test(code)) return setError('자원 코드는 영문·숫자·-, _만 사용할 수 있습니다.');
    changeResource(code, draft?.inventory[code] ?? 0); setNewResource(''); setError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    let robotAssignments: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(assignmentsText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      robotAssignments = parsed as Record<string, unknown>;
    } catch { return setError('자동수집 배치는 JSON 객체 형식이어야 합니다.'); }
    setBusy(true); setError(''); setNotice('');
    try { apply(await updateMyRoomDungeonProfile(accountId, { ...draft, robotAssignments })); setNotice(profile?.profileExists ? '진행 데이터를 저장했습니다.' : '진행 데이터를 생성했습니다.'); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  const removeProfile = async () => {
    if (!profile?.profileExists || busy || !window.confirm(`${profile.nickname}의 내방이 던전 진행 데이터를 모두 삭제합니다. 계정은 삭제되지 않습니다. 진행할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await deleteMyRoomDungeonProfile(accountId); apply(await getMyRoomDungeonProfile(accountId)); setNotice('게임 진행 데이터를 삭제했습니다.'); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="admin-detail">
      <button type="button" className="admin-link" onClick={onBack}>← 계정 목록으로</button>
      {error && <p className="admin-error">{error}</p>}
      {!profile || !draft ? !error && <p className="admin-muted">불러오는 중…</p> : (
        <>
          <dl className="admin-summary">
            <div><dt>계정</dt><dd>#{profile.accountId} {profile.nickname} ({profile.loginId})</dd></div>
            <div><dt>진행 데이터</dt><dd>{profile.profileExists ? '저장됨' : '아직 없음'}</dd></div>
            <div><dt>자동수집 중</dt><dd>{Object.keys(profile.robotAssignments).length}곳</dd></div>
            <div><dt>최근 저장</dt><dd>{profile.updatedAt ? new Date(profile.updatedAt).toLocaleString('ko-KR') : '-'}</dd></div>
          </dl>
          <p className="admin-muted">저장하면 사용자가 게임을 새로고침하거나 다시 진입할 때 반영됩니다.</p>
          {notice && <p className="admin-notice">{notice}</p>}
          <form className="admin-dungeon-form" onSubmit={save}>
            <fieldset><legend>보유 상품</legend>
              <div className="admin-dungeon-counts">
                <label>채집봇 수<input type="number" min={0} value={draft.craftedBots} onChange={(e) => setDraft({ ...draft, craftedBots: Number(e.target.value) })} /></label>
                <label>무기 수<input type="number" min={0} value={draft.craftedSwords} onChange={(e) => setDraft({ ...draft, craftedSwords: Number(e.target.value) })} /></label>
              </div>
            </fieldset>
            <fieldset><legend>보유 자원</legend>
              <div className="admin-resource-grid">{Object.entries(draft.inventory).map(([code, amount]) => (
                <div className="admin-resource-row" key={code}>
                  <label><span>{RESOURCE_LABELS[code] ?? code}<small>{code}</small></span><input type="number" min={0} value={amount} onChange={(e) => changeResource(code, Number(e.target.value))} /></label>
                  <button type="button" className="admin-danger" onClick={() => removeResource(code)}>삭제</button>
                </div>
              ))}</div>
              <div className="admin-inline-add"><input value={newResource} onChange={(e) => setNewResource(e.target.value)} placeholder="새 자원 코드" /><button type="button" onClick={addResource}>자원 추가</button></div>
            </fieldset>
            <fieldset><legend>진행도</legend>
              <label>발견 자원 코드 (쉼표 구분)<input value={draft.discovered.join(', ')} onChange={(e) => setDraft({ ...draft, discovered: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></label>
              <label>클리어 구역 (쉼표 구분)<input value={draft.clearedZones.join(', ')} onChange={(e) => setDraft({ ...draft, clearedZones: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></label>
            </fieldset>
            <fieldset><legend>자동수집 봇 배치</legend>
              <textarea value={assignmentsText} onChange={(e) => setAssignmentsText(e.target.value)} rows={9} spellCheck={false} />
            </fieldset>
            <div className="admin-savebar"><button type="submit" className="primary" disabled={busy}>{busy ? '저장 중…' : profile.profileExists ? '전체 변경 저장' : '진행 데이터 생성'}</button></div>
          </form>
          <button type="button" className="admin-danger admin-profile-delete" disabled={busy || !profile.profileExists} onClick={removeProfile}>내방이 던전 진행 데이터 삭제</button>
        </>
      )}
    </div>
  );
}
