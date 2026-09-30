import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NumberHeroTowerGame } from './NumberHeroTowerGame';

createRoot(document.getElementById('root')!).render(
  <StrictMode><NumberHeroTowerGame /></StrictMode>,
);
