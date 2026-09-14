import { useEffect, useRef } from 'react';
import { mountGame as mountTowerDefense } from 'tower-defense';
import { mountGame as mountOffenseTower } from 'offense-tower';
import { mountGame as mountStrategyMarbles } from 'strategy-marbles';
import type { NetworkOptions } from 'strategy-marbles';
import type Phaser from 'phaser';
import { useMultiplayer } from './multiplayer/MultiplayerContext';
import { usePortraitNarrow } from './usePortraitNarrow';
import { RotatePrompt } from './RotatePrompt';
import type { GameId } from './games';

// These games use a fixed 14x8 landscape grid - unlike strategy-marbles'
// near-square board, it doesn't scale down to a usable size on a narrow
// portrait phone screen. Prompt for landscape instead of rendering it tiny.
const LANDSCAPE_ONLY_GAMES: GameId[] = ['tower-defense', 'offense-tower'];

interface GameScreenProps {
  gameId: GameId;
  roundId: number;
  onExit: () => void;
}

export function GameScreen({ gameId, roundId, onExit }: GameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const multiplayer = useMultiplayer();
  const isPortraitNarrow = usePortraitNarrow();
  const showRotatePrompt = LANDSCAPE_ONLY_GAMES.includes(gameId) && isPortraitNarrow;

  const networkRoom = gameId === 'strategy-marbles' && multiplayer.room?.status === 'playing' ? multiplayer.room : null;
  const socket = multiplayer.getSocket();

  useEffect(() => {
    if (!containerRef.current) return;
    // Waiting on the multiplayer room/socket to be ready - the effect below
    // re-runs once they are (see the dependency array).
    if (gameId === 'strategy-marbles' && networkRoom && (!socket || !multiplayer.selfId)) return;
    let cancelled = false;

    const network: NetworkOptions | undefined =
      networkRoom && socket && multiplayer.selfId
        ? {
            socket,
            selfId: multiplayer.selfId,
            playerIds: networkRoom.players.map((p) => p.id),
            playerNames: networkRoom.players.map((p) => p.name),
            roomCode: networkRoom.roomCode,
            isHost: networkRoom.players.find((p) => p.id === multiplayer.selfId)?.isHost ?? false,
          }
        : undefined;

    const effectiveRoundId = networkRoom ? networkRoom.roundId : roundId;
    const mount =
      gameId === 'offense-tower'
        ? mountOffenseTower(containerRef.current, { roundId })
        : gameId === 'strategy-marbles'
          ? Promise.resolve(mountStrategyMarbles(containerRef.current, { roundId: effectiveRoundId, network }))
          : Promise.resolve(mountTowerDefense(containerRef.current));

    mount.then((game) => {
      if (cancelled) {
        game.destroy(true);
        return;
      }
      gameRef.current = game;
    });

    return () => {
      cancelled = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, roundId, networkRoom, socket, multiplayer.selfId]);

  return (
    <div className="game-screen">
      <button type="button" className="exit-button" onClick={onExit}>
        ← 게임 허브로
      </button>
      <div className="game-canvas-wrapper">
        <div ref={containerRef} className="game-canvas-container" />
        {showRotatePrompt && <RotatePrompt />}
      </div>
    </div>
  );
}
