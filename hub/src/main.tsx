import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MultiplayerProvider } from './multiplayer/MultiplayerContext'

createRoot(document.getElementById('root')!).render(
  <MultiplayerProvider>
    <App />
  </MultiplayerProvider>,
)
