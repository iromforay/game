import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getMergeDefenseProfile, searchMergeDefenseAccounts, updateMergeDefenseProfile } from './adminClient';
import type { AdminMergeDefenseProfile, AdminMergeDefenseUpdate } from './adminClient';

function errorText(err: unknown) {
  return err instanceof Error ? err.message : '요청에 실패했습니다';
}

function progressLabel(stage: number) {
  if (stage <= 0) return '진행 없음';
  return `${Math.floor((stage - 1) / 10) + 1}-${((stage - 1) % 10) + 1}`;
}

export function MergeDefenseAdminTab() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminMergeDefenseProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    try { setRows(await searchMergeDefenseAccounts(query)); } catch (err) { setError(errorText(err)); }
  };

  useEffect(() => { void search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (selectedId) return <MergeDefenseProfileEditor accountId={selectedId} onBack={() => { setSelectedId(null); void search(); }} />;

  return (
    <>
      <p className="admin-section-path">광고게임 &gt; 장난감 머지 방어전</p>
      <form className="admin-search" onSubmit={search}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계정 id · 로그인 아이디 · 닉네임" />
        <button type="submit">검색</button>
      </form>
      {error && <p className="admin-error">{error}</p>}
      {rows && rows.length === 0 && <p className="admin-muted">검색 결과가 없습니다.</p>}
      {rows && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>계정</th><th className="num">은화</th><th>도감</th><th>영구 강화</th><th>진행</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.accountId} className="clickable" onClick={() => setSelectedId(row.accountId)}>
                <td><strong>{row.nickname}</strong><br /><span className="admin-muted">#{row.accountId} · {row.loginId}</span></td>
                <td className="num">{row.silver.toLocaleString()}</td>
                <td>{row.collectionUnlocked}/{row.collectionTotal}<br /><span className="admin-muted">검 {row.warriorUnlocked} · 궁 {row.archerUnlocked} · 마 {row.spellbladeUnlocked}</span></td>
                <td>공격 {row.attackLevel} · 코인 {row.startCoinLevel} · 할인 {row.summonDiscountLevel}</td>
                <td>{progressLabel(row.highestClearedStage)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function MergeDefenseProfileEditor({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const [profile, setProfile] = useState<AdminMergeDefenseProfile | null>(null);
  const [draft, setDraft] = useState<AdminMergeDefenseUpdate | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMergeDefenseProfile(accountId).then((next) => {
      setProfile(next);
      setDraft(toUpdate(next));
    }).catch((err: unknown) => setError(errorText(err)));
  }, [accountId]);

  const completion = useMemo(() => draft ? draft.warriorUnlocked + draft.archerUnlocked + draft.spellbladeUnlocked : 0, [draft]);
  const setNumber = (key: keyof AdminMergeDefenseUpdate, value: string) => setDraft((current) => current ? { ...current, [key]: Number(value) } : current);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile || !draft || busy) return;
    if (!window.confirm(`${profile.nickname}(${profile.loginId})의 머지 디펜스 정보를 변경합니다. 진행할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await updateMergeDefenseProfile(accountId, draft);
      setProfile(next); setDraft(toUpdate(next)); setNotice('머지 디펜스 정보를 저장했습니다.');
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <div className="admin-detail">
      <button type="button" className="admin-link" onClick={onBack}>← 계정 목록으로</button>
      {error && <p className="admin-error">{error}</p>}
      {!profile && !error && <p className="admin-muted">불러오는 중…</p>}
      {profile && draft && (
        <>
          <dl className="admin-summary">
            <div><dt>계정</dt><dd>#{profile.accountId} {profile.nickname} ({profile.loginId})</dd></div>
            <div><dt>은화</dt><dd>{profile.silver.toLocaleString()}</dd></div>
            <div><dt>도감 완성도</dt><dd>{completion} / 30 · {Math.round((completion / 30) * 100)}%</dd></div>
            <div><dt>최고 클리어</dt><dd>{progressLabel(profile.highestClearedStage)}</dd></div>
          </dl>
          <p className="admin-muted">수정 내용은 사용자가 머지 디펜스 화면에 다시 진입하거나 새로고침하면 반영됩니다.</p>
          {notice && <p className="admin-notice">{notice}</p>}
          <form className="admin-merge-form" onSubmit={save}>
            <fieldset><legend>보유 재화</legend><label>은화<input type="number" min={0} max={4294967295} value={draft.silver} onChange={(e) => setNumber('silver', e.target.value)} /></label></fieldset>
            <fieldset><legend>도감 완성도</legend>
              <label>검사 발견 단계<input type="number" min={1} max={10} value={draft.warriorUnlocked} onChange={(e) => setNumber('warriorUnlocked', e.target.value)} /></label>
              <label>궁수 발견 단계<input type="number" min={1} max={10} value={draft.archerUnlocked} onChange={(e) => setNumber('archerUnlocked', e.target.value)} /></label>
              <label>마검사 발견 단계<input type="number" min={0} max={10} value={draft.spellbladeUnlocked} onChange={(e) => setNumber('spellbladeUnlocked', e.target.value)} /></label>
              <label className="admin-check"><input type="checkbox" checked={draft.spellbladeRecipeUnlocked} onChange={(e) => setDraft({ ...draft, spellbladeRecipeUnlocked: e.target.checked })} /> 마검사 합성법 해금</label>
            </fieldset>
            <fieldset><legend>영구 강화</legend>
              <label>전체 공격력 단계 (0~8)<input type="number" min={0} max={8} value={draft.attackLevel} onChange={(e) => setNumber('attackLevel', e.target.value)} /></label>
              <label>시작 코인 단계 (0~5)<input type="number" min={0} max={5} value={draft.startCoinLevel} onChange={(e) => setNumber('startCoinLevel', e.target.value)} /></label>
              <label>소환 할인 단계 (0~5)<input type="number" min={0} max={5} value={draft.summonDiscountLevel} onChange={(e) => setNumber('summonDiscountLevel', e.target.value)} /></label>
            </fieldset>
            <fieldset><legend>스테이지 진행</legend>
              <label>최고 클리어 스테이지<select value={draft.highestClearedStage} onChange={(e) => setNumber('highestClearedStage', e.target.value)}>
                <option value={0}>진행 없음 · 1-1 도전 가능</option>
                {Array.from({ length: 50 }, (_, index) => index + 1).map((stage) => <option key={stage} value={stage}>{progressLabel(stage)} 클리어</option>)}
              </select></label>
              <p className="admin-muted">각 챕터의 10번째 스테이지를 클리어하면 다음 챕터가 해금됩니다. 5-10은 종장 완료입니다.</p>
            </fieldset>
            <div className="admin-savebar"><button type="submit" className="primary" disabled={busy}>{busy ? '저장 중…' : '전체 변경 저장'}</button></div>
          </form>
        </>
      )}
    </div>
  );
}

function toUpdate(profile: AdminMergeDefenseProfile): AdminMergeDefenseUpdate {
  return {
    silver: profile.silver,
    warriorUnlocked: profile.warriorUnlocked,
    archerUnlocked: profile.archerUnlocked,
    spellbladeUnlocked: profile.spellbladeUnlocked,
    spellbladeRecipeUnlocked: profile.spellbladeRecipeUnlocked,
    attackLevel: profile.attackLevel,
    startCoinLevel: profile.startCoinLevel,
    summonDiscountLevel: profile.summonDiscountLevel,
    highestClearedStage: profile.highestClearedStage,
  };
}
