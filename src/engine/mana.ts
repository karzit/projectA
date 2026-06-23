// Mana cost representation, parsing, and payment from a mana pool.

import type { ManaColor, ManaCost, ManaPool } from './types.js';

const COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function emptyCost(): ManaCost {
  return { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

// Parse a cost string like "1R", "2WW", "3", "" (free) into a ManaCost.
// Digits accumulate into the generic portion; letters are colored pips.
export function parseCost(str: string): ManaCost {
  const cost = emptyCost();
  let digits = '';
  for (const ch of str.toUpperCase()) {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
    } else if (COLORS.includes(ch as ManaColor)) {
      cost[ch as ManaColor]++;
    } else if (ch === ' ') {
      continue;
    } else {
      throw new Error(`Unrecognized mana symbol: ${ch}`);
    }
  }
  if (digits) cost.generic += parseInt(digits, 10);
  return cost;
}

function poolTotal(pool: ManaPool): number {
  return COLORS.reduce((sum, c) => sum + pool[c], 0);
}

// Can `pool` cover `cost`? Colored pips must be paid with their own color;
// whatever remains after that must cover the generic portion.
export function canPay(pool: ManaPool, cost: ManaCost): boolean {
  let leftover = poolTotal(pool);
  for (const c of COLORS) {
    if (pool[c] < cost[c]) return false;
    leftover -= cost[c];
  }
  return leftover >= cost.generic;
}

// Return a NEW pool with `cost` deducted. Caller must have checked canPay.
// Generic is paid in a fixed order (C, W, U, B, R, G) for determinism.
export function pay(pool: ManaPool, cost: ManaCost): ManaPool {
  const out: ManaPool = { ...pool };
  for (const c of COLORS) out[c] -= cost[c];
  let generic = cost.generic;
  for (const c of COLORS) {
    if (generic <= 0) break;
    const use = Math.min(out[c], generic);
    out[c] -= use;
    generic -= use;
  }
  if (generic > 0) throw new Error('pay() called without sufficient mana');
  return out;
}
