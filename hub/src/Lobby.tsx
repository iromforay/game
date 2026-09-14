import { useEffect, useState } from 'react';
import { loadHero, DEFAULT_HERO, STAGES, isRoundCleared } from 'offense-tower';
import type { HeroDef } from 'offense-tower';
import { fetchAllRoundMaps } from 'strategy-marbles';
import type { RoundMapDef } from 'strategy-marbles';
import { MultiplayerLobby } from './multiplayer/MultiplayerLobby';
import { GAMES } from './games';
import type { GameId } from './games';

function floorFeel(friction: number): string {
  if (friction <= 3) return '미끄러움';
  if (friction <= 7) return '보통';
  return '거침';
}

interface LobbyProps {
  gameId: GameId;
  roundId: number;
  onSelectRound: (roundId: number) => void;
  onStart: () => void;
  onBack: () => void;
}

type MarblesScreen = 'mode' | 'single' | 'multi';

export function Lobby({ gameId, roundId, onSelectRound, onStart, onBack }: LobbyProps) {
  const game = GAMES.find((g) => g.id === gameId)!;
  const [hero, setHero] = useState<HeroDef | null>(null);
  const [marblesScreen, setMarblesScreen] = useState<MarblesScreen>('mode');
  const [roundMaps, setRoundMaps] = useState<RoundMapDef[] | null>(null);

  useEffect(() => {
    if (gameId !== 'offense-tower') return;
    let cancelled = false;
    loadHero(DEFAULT_HERO).then((h) => {
      if (!cancelled) setHero(h);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (gameId !== 'strategy-marbles' || marblesScreen !== 'single') return;
    let cancelled = false;
    setRoundMaps(null);
    fetchAllRoundMaps().then((maps) => {
      if (!cancelled) setRoundMaps(maps);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, marblesScreen]);

  if (gameId === 'strategy-marbles') {
    return (
      <div className="lobby">
        {marblesScreen !== 'multi' && (
          <button
            type="button"
            className="exit-button"
            onClick={marblesScreen === 'mode' ? onBack : () => setMarblesScreen('mode')}
          >
            ← {marblesScreen === 'mode' ? '게임 허브로' : '모드 선택으로'}
          </button>
        )}

        <h1>{game.title}</h1>

        {marblesScreen === 'mode' && (
          <>
            <section className="lobby-section">
              <h2>공지</h2>
              <p className="placeholder-note">등록된 공지가 없습니다.</p>
            </section>

            <section className="lobby-section">
              <h2>설정</h2>
              <p className="placeholder-note">설정은 아직 준비 중입니다.</p>
            </section>

            <section className="lobby-section">
              <h2>모드 선택</h2>
              <div className="mode-select-list">
                <button type="button" className="mode-select-button" onClick={() => setMarblesScreen('single')}>
                  <span className="mode-select-title">싱글 모드</span>
                  <span className="mode-select-desc">같은 화면에서 턴을 넘기며 연습하는 로컬 모드</span>
                </button>
                <button type="button" className="mode-select-button" onClick={() => setMarblesScreen('multi')}>
                  <span className="mode-select-title">멀티 모드</span>
                  <span className="mode-select-desc">방을 만들거나 코드로 참가해 대전 (대전 로직 연동은 준비 중)</span>
                </button>
              </div>
            </section>
          </>
        )}

        {marblesScreen === 'single' && (
          <>
            <div className="marbles-screen-label">싱글모드</div>

            <section className="lobby-section">
              <h2>라운드 맵 선택</h2>
              {roundMaps ? (
                <table className="round-table">
                  <thead>
                    <tr>
                      <th>맵</th>
                      <th>바닥</th>
                      <th>기물 수</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundMaps.map((map) => {
                      const selected = map.id === roundId;
                      return (
                        <tr key={map.id} className={selected ? 'round-row-selected' : ''}>
                          <td>{map.name}</td>
                          <td>{floorFeel(map.floorFriction)}</td>
                          <td>{map.terrain.length}</td>
                          <td>
                            <button type="button" className="round-select-button" onClick={() => onSelectRound(map.id)}>
                              {selected ? '선택됨' : '선택'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="placeholder-note">맵 목록을 불러오는 중...</p>
              )}
            </section>

            <section className="lobby-section">
              <h2>채팅</h2>
              <p className="placeholder-note">채팅은 추후 지원 예정입니다.</p>
            </section>

            <button type="button" className="start-button" onClick={onStart}>
              게임 시작
            </button>
          </>
        )}

        {marblesScreen === 'multi' && <MultiplayerLobby onExit={() => setMarblesScreen('mode')} />}
      </div>
    );
  }

  return (
    <div className="lobby">
      <button type="button" className="exit-button" onClick={onBack}>
        ← 게임 허브로
      </button>

      <h1>{game.title}</h1>

      <section className="lobby-section">
        <h2>공지</h2>
        <p className="placeholder-note">등록된 공지가 없습니다.</p>
      </section>

      <section className="lobby-section">
        <h2>설정</h2>
        <p className="placeholder-note">설정은 아직 준비 중입니다.</p>
      </section>

      {gameId === 'offense-tower' && (
        <>
          <section className="lobby-section">
            <h2>라운드 선택</h2>
            <table className="round-table">
              <thead>
                <tr>
                  <th>라운드</th>
                  <th>클리어 목표</th>
                  <th>상태</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((stage) => {
                  const cleared = isRoundCleared(stage.id);
                  const selected = stage.id === roundId;
                  return (
                    <tr key={stage.id} className={selected ? 'round-row-selected' : ''}>
                      <td>{stage.name}</td>
                      <td>돌파 {stage.goalBreakthroughs}회</td>
                      <td>{cleared ? '✅ 클리어' : '미클리어'}</td>
                      <td>
                        <button type="button" className="round-select-button" onClick={() => onSelectRound(stage.id)}>
                          {selected ? '선택됨' : '선택'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="placeholder-note">클리어한 라운드도 언제든 다시 플레이할 수 있습니다.</p>
          </section>

          <section className="lobby-section">
            <h2>영웅 선택</h2>
            {hero ? (
              <div className="hero-card">
                <span className="hero-card-name">{hero.name}</span>
                <span className="hero-card-desc">{hero.description}</span>
                <span className="hero-card-stats">
                  HP {hero.hp} · 속도 {hero.speed} · 전 타워 내성 {Math.round((1 - hero.resistance) * 100)}%
                </span>
              </div>
            ) : (
              <p className="placeholder-note">영웅 정보를 불러오는 중...</p>
            )}
            <p className="placeholder-note">게임당 1회만 소환할 수 있습니다. 영웅 커스터마이징(사진 등록)은 준비 중입니다.</p>
          </section>
        </>
      )}

      <section className="lobby-section">
        <h2>채팅</h2>
        <p className="placeholder-note">채팅은 추후 지원 예정입니다.</p>
      </section>

      <button type="button" className="start-button" onClick={onStart}>
        게임 시작
      </button>
    </div>
  );
}
