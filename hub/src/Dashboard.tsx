import { GAMES, CARD_FRAME_URL } from './games';
import type { GameId } from './games';

interface DashboardProps {
  onSelectGame: (gameId: GameId) => void;
  onOpenKirbyGuide: () => void;
}

export function Dashboard({ onSelectGame, onOpenKirbyGuide }: DashboardProps) {
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
              style={{ backgroundImage: `url(${CARD_FRAME_URL})` }}
              onClick={() => onSelectGame(game.id)}
            >
              <img className="game-select-icon" src={game.iconUrl} alt="" />
              <span className="game-select-text">
                <span className="game-select-title">{game.title}</span>
                <span className="game-select-desc">{game.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-section">
        <h2>도감</h2>
        <button type="button" className="dashboard-link-button" onClick={onOpenKirbyGuide}>
          커비 훔치기 도감 보기 (캐릭터·등급·무기 안내)
        </button>
      </section>
    </div>
  );
}
