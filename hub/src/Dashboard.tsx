import { GAMES, CARD_FRAME_URL } from './games';
import type { GameId } from './games';
import kirbyGuideIconUrl from './assets/cards/icon-steal-a-kirby.png';
import { AccountPanel } from './account/AccountPanel';

interface DashboardProps {
  onSelectGame: (gameId: GameId) => void;
  onOpenKirbyGuide: () => void;
}

export function Dashboard({ onSelectGame, onOpenKirbyGuide }: DashboardProps) {
  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>게임 허브</h1>
        <p className="dashboard-subtitle">플레이할 게임을 선택하세요.</p>
        <AccountPanel />
      </div>

      <section className="dashboard-section dashboard-section-games" aria-label="게임 선택">
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

      <section className="dashboard-section dashboard-section-guide" aria-label="도감">
        <button type="button" className="dashboard-guide-button" onClick={onOpenKirbyGuide}>
          <img className="dashboard-guide-icon" src={kirbyGuideIconUrl} alt="" />
          <span className="dashboard-guide-text">
            <span className="dashboard-guide-title">커비 훔치기 도감</span>
            <span className="dashboard-guide-desc">캐릭터·등급·무기 정보 보기</span>
          </span>
        </button>
      </section>
    </div>
  );
}
