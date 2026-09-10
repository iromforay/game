import { GAMES } from './games';
import type { GameId } from './games';

interface LobbyProps {
  gameId: GameId;
  onStart: () => void;
  onBack: () => void;
}

export function Lobby({ gameId, onStart, onBack }: LobbyProps) {
  const game = GAMES.find((g) => g.id === gameId)!;

  return (
    <div className="lobby">
      <button type="button" className="exit-button" onClick={onBack}>
        ← 대시보드로
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
        <section className="lobby-section">
          <h2>영웅 선택</h2>
          <p className="placeholder-note">영웅 시스템은 아직 준비 중입니다.</p>
        </section>
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
