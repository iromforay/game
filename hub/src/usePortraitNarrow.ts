import { useEffect, useState } from 'react';

// Landscape-only games (14x8 grid, ~1.35:1) become unplayably small when
// Phaser.Scale.FIT shrinks them to a narrow portrait viewport's width - HUD
// buttons and text end up a few px tall. Detect that situation so the caller
// can show a "rotate your device" prompt instead of a broken-looking game.
const QUERY = '(max-width: 900px) and (orientation: portrait)';

export function usePortraitNarrow(): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false));

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return matches;
}
