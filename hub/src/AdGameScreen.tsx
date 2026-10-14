import { NumberHeroTowerGame } from 'number-hero-tower';
import { MyRoomDungeonGame } from 'my-room-dungeon';
import { SweetShopGame } from 'sweet-shop';
import { NumberGateRunnerScreen } from './NumberGateRunnerScreen';
import type { AdGameId } from './adGames';
import { GameResultCard } from './scoreboard/GameResultCard';
import type { RankingGame } from './scoreboard/scoreboardClient';
import { MergeDefenseScreen } from './MergeDefenseScreen';

interface AdGameScreenProps {
  gameId: AdGameId;
  onExit: () => void;
  onOpenRanking: (game: RankingGame, roundId?: number) => void;
}

export function AdGameScreen({ gameId, onExit, onOpenRanking }: AdGameScreenProps) {
  if (gameId === 'sweet-shop') {
    return (
      <div className="ad-game-react-screen">
        <SweetShopGame onExit={onExit} />
      </div>
    );
  }

  if (gameId === 'my-room-dungeon') {
    return (
      <div className="ad-game-react-screen">
        <MyRoomDungeonGame onExit={onExit} />
      </div>
    );
  }

  if (gameId === 'merge-defense') {
    return (
      <div className="ad-game-react-screen">
        <MergeDefenseScreen onExit={onExit} />
        <GameResultCard onOpenRanking={onOpenRanking} />
      </div>
    );
  }

  if (gameId === 'number-hero-tower') {
    return (
      <div className="ad-game-react-screen">
        <NumberHeroTowerGame onExit={onExit} />
        <GameResultCard onOpenRanking={onOpenRanking} />
      </div>
    );
  }

  if (gameId === 'number-gate-runner') {
    return (
      <div className="ad-game-react-screen">
        <NumberGateRunnerScreen onExit={onExit} />
        <GameResultCard onOpenRanking={onOpenRanking} />
      </div>
    );
  }

  return null;
}
