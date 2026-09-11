import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { Lobby } from './Lobby';
import { GameScreen } from './GameScreen';
import { useMultiplayer } from './multiplayer/MultiplayerContext';
import type { GameId } from './games';
import './App.css';

type Screen = 'dashboard' | 'lobby' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);
  const [selectedRound, setSelectedRound] = useState(1);
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

  if (screen === 'game' && selectedGame) {
    return <GameScreen gameId={selectedGame} roundId={selectedRound} onExit={handleExitGame} />;
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
    />
  );
}

export default App;
