import { useEffect, useState } from 'react';

// Landscape-only games (14x8 grid, ~1.35:1) become unplayably small when
// Phaser.Scale.FIT shrinks them to a narrow portrait viewport's width - HUD
// buttons and text end up a few px tall. Detect that situation so the caller
// can show a "rotate your device" prompt instead of a broken-looking game.
const PORTRAIT_QUERY = '(max-width: 900px) and (orientation: portrait)';

// Our Android hybrid app (Trusted Web Activity) reports this display-mode,
// same as an installed PWA. It already locks orientation to landscape at
// the OS level (twa-manifest.json's `orientation: "landscape"`), and its
// WebView can report stale/incorrect viewport dimensions right at launch
// (before the lock fully applies), which made this hook misfire and get
// stuck showing the rotate-prompt even after the device was in landscape.
// Since landscape is already guaranteed there, skip the check entirely.
const STANDALONE_QUERY = '(display-mode: standalone)';

function computeMatches(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia(STANDALONE_QUERY).matches) return false;
  return window.matchMedia(PORTRAIT_QUERY).matches;
}

export function usePortraitNarrow(): boolean {
  const [matches, setMatches] = useState(computeMatches);

  useEffect(() => {
    const standaloneMq = window.matchMedia(STANDALONE_QUERY);
    const portraitMq = window.matchMedia(PORTRAIT_QUERY);
    const update = () => setMatches(computeMatches());
    update();
    standaloneMq.addEventListener('change', update);
    portraitMq.addEventListener('change', update);
    return () => {
      standaloneMq.removeEventListener('change', update);
      portraitMq.removeEventListener('change', update);
    };
  }, []);

  return matches;
}
