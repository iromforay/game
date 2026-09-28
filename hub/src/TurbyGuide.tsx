import { useCallback, useEffect, useState } from 'react';
import { fetchTurbyCollection, gradeColor, turbyImage } from './turbyGuideData';
import type { OwnedTurbyEntry, TurbyCollection } from './turbyGuideData';
import './TurbyGuide.css';

interface TurbyGuideProps {
  onBack: () => void;
}

const dexNo = (no: number) => `No.${String(no).padStart(3, '0')}`;

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function TurbyGuide({ onBack }: TurbyGuideProps) {
  const [collection, setCollection] = useState<TurbyCollection | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<OwnedTurbyEntry | null>(null);

  const load = useCallback(() => {
    setError(false);
    setCollection(null);
    fetchTurbyCollection()
      .then(setCollection)
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!selected) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selected]);

  const percent = collection && collection.total > 0 ? Math.round((collection.ownedCount / collection.total) * 100) : 0;

  return (
    <div className="turby-guide">
      <header className="turby-guide-header">
        <button type="button" className="turby-guide-back" onClick={onBack}>
          ← 허브로
        </button>
        <h1>🧶 터비 구하기 — 캐릭터 도감</h1>
        <p>게임에서 만난 터비만 모습과 이야기가 기록됩니다.</p>
      </header>

      <main className="turby-guide-body">
        {error && (
          <div className="turby-guide-notice" role="alert">
            <p>도감을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>
            <button type="button" className="turby-guide-retry" onClick={load}>
              다시 시도
            </button>
          </div>
        )}

        {!error && !collection && <p className="turby-guide-loading">도감을 펼치는 중…</p>}

        {collection && (
          <>
            <div className="turby-guide-progress" aria-label={`수집 ${collection.ownedCount} / ${collection.total}`}>
              <div className="turby-guide-progress-label">
                <span>수집</span>
                <b>
                  {collection.ownedCount} / {collection.total}
                </b>
              </div>
              <div className="turby-guide-progress-track">
                <div className="turby-guide-progress-fill" style={{ width: `${percent}%` }} />
              </div>
            </div>

            {!collection.playerFound && (
              <p className="turby-guide-notice">
                아직 이 기기에서 터비 구하기를 시작하지 않았어요. 게임에서 터비를 만나면 여기에 기록됩니다.
              </p>
            )}

            <ul className="turby-guide-grid">
              {collection.entries.map((entry) => {
                const image = turbyImage(entry.imageKey);
                if (!entry.owned) {
                  return (
                    <li key={entry.no} className="turby-card unknown" aria-label={`${dexNo(entry.no)} 아직 만나지 못한 터비`}>
                      <span className="turby-card-no">{dexNo(entry.no)}</span>
                      <div className="turby-card-art">{image && <img src={image} alt="" loading="lazy" draggable={false} />}</div>
                      <div className="turby-card-name">???</div>
                      <div className="turby-card-sub">아직 만나지 못했어요</div>
                    </li>
                  );
                }
                return (
                  <li key={entry.no} className="turby-card-slot">
                    <button type="button" className="turby-card" onClick={() => setSelected(entry)}>
                      <span className="turby-card-no">{dexNo(entry.no)}</span>
                      <div className="turby-card-art">{image && <img src={image} alt={entry.name} loading="lazy" />}</div>
                      <div className="turby-card-name">{entry.name}</div>
                      <span className="turby-grade-chip" style={{ background: gradeColor(entry.grade.id) }}>
                        {entry.grade.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>

      {selected && (
        <div className="turby-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="turby-modal" role="dialog" aria-modal="true" aria-label={selected.name} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="turby-modal-close" onClick={() => setSelected(null)} aria-label="닫기">
              ✕
            </button>
            <span className="turby-card-no">{dexNo(selected.no)}</span>
            {turbyImage(selected.imageKey) && <img className="turby-modal-image" src={turbyImage(selected.imageKey)} alt={selected.name} />}
            <h2>{selected.name}</h2>
            <span className="turby-grade-chip" style={{ background: gradeColor(selected.grade.id) }}>
              {selected.grade.name}
            </span>
            {selected.description && <p className="turby-modal-desc">{selected.description}</p>}
            <ul className="turby-modal-stats">
              <li>
                <span>공격</span>
                <b>{selected.stats.attack}</b>
              </li>
              <li>
                <span>방어</span>
                <b>{selected.stats.defense}</b>
              </li>
              <li>
                <span>행동력</span>
                <b>{selected.stats.actionPower}</b>
              </li>
              <li>
                <span>체력</span>
                <b>{selected.stats.maxHp}</b>
              </li>
            </ul>
            <div className="turby-modal-meta">
              <span>보유 {selected.count}마리</span>
              <span>첫 만남 {formatDate(selected.firstAcquiredAt)}</span>
            </div>
            <p className="turby-modal-note">능력치는 등급 기본값이며 강화·장비는 포함하지 않습니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
