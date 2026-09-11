// Maps the designer-facing 0-10 scales from round map JSON files onto the
// Matter.js properties that actually produce the feel.

// 0 = frictionless ice (a small push glides forever), 10 = the egg barely
// moves no matter how hard it's launched. Squared so the low end stays close
// to frictionless and the top end ramps up sharply into "stuck".
export function floorFrictionToAir(level: number): number {
  const clamped = Math.min(10, Math.max(0, level));
  return Math.pow(clamped / 10, 2) * 0.2;
}

// 0 = fully absorbs the impact, 10 = billiard-ball elastic (returns the
// incoming force almost unchanged).
export function bounceToRestitution(level: number): number {
  const clamped = Math.min(10, Math.max(0, level));
  return clamped / 10;
}
