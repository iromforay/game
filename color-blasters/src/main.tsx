import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorBlastersGame } from './ColorBlastersGame';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorBlastersGame />
  </StrictMode>,
);
