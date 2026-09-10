import { useState } from 'react';
import { Dashboard } from './Dashboard';
import { Lobby } from './Lobby';
import { GameScreen } from './GameScreen';
import type { GameId } from './games';
import './App.css';

type Screen = 'dashboard' | 'lobby' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);

  if (screen === 'game' && selectedGame) {
    return <GameScreen gameId={selectedGame} onExit={() => setScreen('dashboard')} />;
  }

  if (screen === 'lobby' && selectedGame) {
    return (
      <Lobby
        gameId={selectedGame}
        onStart={() => setScreen('game')}
        onBack={() => setScreen('dashboard')}
      />
    );
  }

  return (
    <Dashboard
      onSelectGame={(gameId) => {
        setSelectedGame(gameId);
        setScreen('lobby');
      }}
    />
  );
}

export default App;
