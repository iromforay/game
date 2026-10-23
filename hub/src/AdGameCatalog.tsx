import { AD_GAMES } from './adGames';

interface AdGameCatalogProps {
  onBack: () => void;
  onSelectGame: (gameId: (typeof AD_GAMES)[number]['id']) => void;
}

export function AdGameCatalog({ onBack, onSelectGame }: AdGameCatalogProps) {
  return (
    <main className="ad-game-catalog">
      <header className="ad-game-catalog-header">
        <button type="button" className="catalog-back-button" onClick={onBack}>
          ← 게임 허브로
        </button>
        <p className="ad-game-catalog-eyebrow">AD GAME</p>
        <h1>광고게임</h1>
        <p>광고에서 재미있어 보였던 플레이를 속임수 없이 즐겨보세요.</p>
      </header>

      <section className="ad-game-list" aria-label="광고게임 선택">
        {AD_GAMES.map((game) => {
          const isAvailable = game.status === 'available';
          return (
            <button
              key={game.id}
              type="button"
              className="ad-game-card"
              disabled={!isAvailable}
              aria-describedby={`${game.id}-status`}
              onClick={() => isAvailable && onSelectGame(game.id)}
            >
              <span className="ad-game-number" aria-hidden="true">
                {String(game.number).padStart(2, '0')}
              </span>
              <span className="ad-game-card-body">
                <span className="ad-game-title">{game.title}</span>
                <span className="ad-game-description">{game.description}</span>
              </span>
              <span id={`${game.id}-status`} className="ad-game-status">
                {isAvailable ? (game.id === 'color-blasters' ? '게임 연결' : '시작') : '준비 중'}
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}
