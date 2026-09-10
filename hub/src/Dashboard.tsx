import { GAMES } from './games';
import type { GameId } from './games';

interface DashboardProps {
  onSelectGame: (gameId: GameId) => void;
}

export function Dashboard({ onSelectGame }: DashboardProps) {
  return (
    <div className="dashboard">
      <h1>게임 허브</h1>

      <section className="dashboard-section">
        <h2>프로필</h2>
        <p className="placeholder-note">프로필 관리는 아직 준비 중입니다.</p>
      </section>

      <section className="dashboard-section">
        <h2>게임 선택</h2>
        <div className="game-select-list">
          {GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              className="game-select-button"
              onClick={() => onSelectGame(game.id)}
            >
              <span className="game-select-title">{game.title}</span>
              <span className="game-select-desc">{game.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
