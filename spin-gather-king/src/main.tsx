import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpinGatherKingGame } from './SpinGatherKingGame';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpinGatherKingGame />
  </StrictMode>,
);
