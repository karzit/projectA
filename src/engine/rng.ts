// Seeded, deterministic randomness. The PRNG state lives inside GameState
// (state.seed), so the same seed + same action sequence always produces the
// same game — the foundation for replay, spectating, and server authority.

import type { GameState } from './types.js';

// One step of a mulberry32-style generator. Returns a float in [0, 1) and the
// advanced seed.
function next(seed: number): { value: number; seed: number } {
  let s = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: s };
}

// Fisher-Yates shuffle driven by (and advancing) the game's PRNG state.
export function shuffle<T>(state: GameState, arr: readonly T[]): T[] {
  const out = arr.slice();
  let seed = state.seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    const r = next(seed);
    seed = r.seed;
    const j = Math.floor(r.value * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  state.seed = seed;
  return out;
}
