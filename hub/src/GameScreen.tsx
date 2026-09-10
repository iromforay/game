import { useEffect, useRef } from 'react';
import { mountGame as mountTowerDefense } from 'tower-defense';
import { mountGame as mountOffenseTower } from 'offense-tower';
import type Phaser from 'phaser';
import type { GameId } from './games';

const MOUNTERS: Record<GameId, (parent: HTMLElement) => Phaser.Game> = {
  'tower-defense': mountTowerDefense,
  'offense-tower': mountOffenseTower,
};

interface GameScreenProps {
  gameId: GameId;
  onExit: () => void;
}

export function GameScreen({ gameId, onExit }: GameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = MOUNTERS[gameId](containerRef.current);
    gameRef.current = game;

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [gameId]);

  return (
    <div className="game-screen">
      <button type="button" className="exit-button" onClick={onExit}>
        ← 대시보드로
      </button>
      <div ref={containerRef} className="game-canvas-container" />
    </div>
  );
}
