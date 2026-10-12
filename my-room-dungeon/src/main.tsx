import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MyRoomDungeonGame } from './MyRoomDungeonGame';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MyRoomDungeonGame />
  </StrictMode>,
);
