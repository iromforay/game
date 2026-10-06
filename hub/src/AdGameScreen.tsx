import { NumberHeroTowerGame } from 'number-hero-tower';
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
