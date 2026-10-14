import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SweetShopGame } from './SweetShopGame';

createRoot(document.getElementById('root')!).render(<StrictMode><SweetShopGame /></StrictMode>);
