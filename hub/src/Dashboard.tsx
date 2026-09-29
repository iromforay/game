import { useState } from 'react';
import { GAMES, CARD_FRAME_URL } from './games';
import type { GameId } from './games';
import kirbyGuideIconUrl from './assets/cards/icon-steal-a-kirby.png';
import turbyGuideIconUrl from './assets/cards/icon-save-a-turby.png';
import { AccountPanel } from './account/AccountPanel';

interface DashboardProps {
  onSelectGame: (gameId: GameId) => void;
  onOpenKirbyGuide: () => void;
  onOpenTurbyGuide: () => void;
  onOpenRanking: () => void;
  onOpenAdmin: () => void;
  onOpenAdGames: () => void;
}

export function Dashboard({ onSelectGame, onOpenKirbyGuide, onOpenTurbyGuide, onOpenRanking, onOpenAdmin, onOpenAdGames }: DashboardProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>게임 허브</h1>
        <p className="dashboard-subtitle">플레이할 게임을 선택하세요.</p>
        <AccountPanel onSession={(s) => setIsAdmin(!!s?.isAdmin)} />
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
          <button
            type="button"
            className="game-select-button ad-game-entry-button"
            style={{ backgroundImage: `url(${CARD_FRAME_URL})` }}
            onClick={onOpenAdGames}
          >
            <span className="game-select-icon ad-game-entry-icon" aria-hidden="true">AD</span>
            <span className="game-select-text">
              <span className="game-select-title">광고게임</span>
              <span className="game-select-desc">광고에서 보던 게임을 직접 플레이</span>
            </span>
          </button>
        </div>
      </section>

      <section className="dashboard-section dashboard-section-guide" aria-label="랭킹">
        <button type="button" className="dashboard-guide-button" onClick={onOpenRanking}>
          <span className="dashboard-guide-icon dashboard-ranking-icon" aria-hidden="true">🏆</span>
          <span className="dashboard-guide-text">
            <span className="dashboard-guide-title">랭킹</span>
            <span className="dashboard-guide-desc">게임별 전체 순위 보기</span>
          </span>
        </button>
      </section>

      <section className="dashboard-section dashboard-section-guide" aria-label="도감">
        <button type="button" className="dashboard-guide-button" onClick={onOpenKirbyGuide}>
          <img className="dashboard-guide-icon" src={kirbyGuideIconUrl} alt="" />
          <span className="dashboard-guide-text">
            <span className="dashboard-guide-title">커비 훔치기 도감</span>
            <span className="dashboard-guide-desc">캐릭터·등급·무기 정보 보기</span>
          </span>
        </button>
        <button type="button" className="dashboard-guide-button" onClick={onOpenTurbyGuide}>
          <img className="dashboard-guide-icon" src={turbyGuideIconUrl} alt="" />
          <span className="dashboard-guide-text">
            <span className="dashboard-guide-title">터비 구하기 캐릭터 도감</span>
            <span className="dashboard-guide-desc">내가 만난 터비 기록 보기</span>
          </span>
        </button>
      </section>

      {isAdmin && (
        <section className="dashboard-section dashboard-section-guide" aria-label="관리자">
          <button type="button" className="dashboard-guide-button" onClick={onOpenAdmin}>
            <span className="dashboard-guide-icon dashboard-ranking-icon" aria-hidden="true">🛠</span>
            <span className="dashboard-guide-text">
              <span className="dashboard-guide-title">관리자</span>
              <span className="dashboard-guide-desc">백오피스 · 유저·커비·골드 관리</span>
            </span>
          </button>
        </section>
      )}
    </div>
  );
}
