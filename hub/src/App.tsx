import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { Lobby } from './Lobby';
import { GameScreen } from './GameScreen';
import { KirbyGuide } from './KirbyGuide';
import { TurbyGuide } from './TurbyGuide';
import { Leaderboard } from './scoreboard/Leaderboard';
import { AdminPage } from './admin/AdminPage';
import type { RankingGame } from './scoreboard/scoreboardClient';
import { useMultiplayer } from './multiplayer/MultiplayerContext';
import type { GameId } from './games';
import './App.css';

type Screen = 'dashboard' | 'lobby' | 'game' | 'kirby-guide' | 'turby-guide' | 'ranking' | 'admin';

function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);
  const [selectedRound, setSelectedRound] = useState(1);
  const [ranking, setRanking] = useState<{ game?: RankingGame; roundId?: number }>({});
  const multiplayer = useMultiplayer();

  // A multiplayer match starts the instant the host's startGame lands on the
  // server, not from this client's own button click - every player in the
  // room (host and guests alike) jumps to the game screen off this signal.
  useEffect(() => {
    if (multiplayer.room?.status === 'playing' && screen !== 'game') {
      setSelectedGame('strategy-marbles');
      setScreen('game');
    }
  }, [multiplayer.room?.status, screen]);

  const handleExitGame = () => {
    if (multiplayer.room) multiplayer.leaveRoom();
    setScreen('dashboard');
  };

  const openRanking = (game?: RankingGame, roundId?: number) => {
    if (multiplayer.room) multiplayer.leaveRoom();
    setRanking({ game, roundId });
    setScreen('ranking');
  };

  if (screen === 'ranking') {
    return <Leaderboard initialGame={ranking.game} initialRoundId={ranking.roundId} onBack={() => setScreen('dashboard')} />;
  }

  if (screen === 'admin') {
    return <AdminPage onBack={() => setScreen('dashboard')} />;
  }

  if (screen === 'kirby-guide') {
    return <KirbyGuide onBack={() => setScreen('dashboard')} />;
  }

  if (screen === 'turby-guide') {
    return <TurbyGuide onBack={() => setScreen('dashboard')} />;
  }

  if (screen === 'game' && selectedGame) {
    return <GameScreen gameId={selectedGame} roundId={selectedRound} onExit={handleExitGame} onOpenRanking={openRanking} />;
  }

  if (screen === 'lobby' && selectedGame) {
    return (
      <Lobby
        gameId={selectedGame}
        roundId={selectedRound}
        onSelectRound={setSelectedRound}
        onStart={() => setScreen('game')}
        onBack={() => setScreen('dashboard')}
      />
    );
  }

  return (
    <Dashboard
      onSelectGame={(gameId) => {
        setSelectedGame(gameId);
        setSelectedRound(1);
        setScreen('lobby');
      }}
      onOpenKirbyGuide={() => setScreen('kirby-guide')}
      onOpenTurbyGuide={() => setScreen('turby-guide')}
      onOpenRanking={() => openRanking()}
      onOpenAdmin={() => setScreen('admin')}
    />
  );
}

export default App;
