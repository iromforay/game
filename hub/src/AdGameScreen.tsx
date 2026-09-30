import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { mountGame as mountNumberGateRunner } from '../../number-gate-runner/src/game';
import { NumberHeroTowerGame } from 'number-hero-tower';
import type { AdGameId } from './adGames';
import { GameResultCard } from './scoreboard/GameResultCard';
import type { RankingGame } from './scoreboard/scoreboardClient';

interface AdGameScreenProps {
  gameId: AdGameId;
  onExit: () => void;
  onOpenRanking: (game: RankingGame, roundId?: number) => void;
}

export function AdGameScreen({ gameId, onExit, onOpenRanking }: AdGameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameId !== 'number-gate-runner') return;
    const game = mountNumberGateRunner(containerRef.current);
    gameRef.current = game;
    const refresh = () => game.scale.refresh();
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      game.destroy(true);
      gameRef.current = null;
    };
  }, [gameId]);

  if (gameId === 'number-hero-tower') {
    return (
      <div className="ad-game-react-screen">
        <NumberHeroTowerGame onExit={onExit} />
        <GameResultCard onOpenRanking={onOpenRanking} />
      </div>
    );
  }

  return (
    <div className="game-screen">
      <button type="button" className="exit-button" onClick={onExit}>
        ← 광고게임으로
      </button>
      <div className="game-canvas-wrapper ad-game-canvas-wrapper">
        <div ref={containerRef} className="game-canvas-container" />
      </div>
      <GameResultCard onOpenRanking={onOpenRanking} />
    </div>
  );
}
