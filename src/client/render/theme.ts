// Visual constants and color helpers shared by the renderer. Kept tiny and
// data-only so layout, sprites, and overlay all agree on dimensions.

import type { CardDef, ManaColor } from '../../engine/index.js';

export const CARD = { w: 92, h: 128, radius: 9, gap: 12 } as const;

export const UI = {
  bg: '#070b16',
  region: 'rgba(255,255,255,0.035)',
  regionLine: 'rgba(255,255,255,0.08)',
  text: '#e9edf6',
  sub: '#9aa6bd',
  hover: '#7fd1ff',
  arrow: '#ff5470',
  drop: '#5be0a0', // valid card-drop zone outline
  dropFill: 'rgba(91,224,160,0.10)',
  dropFillActive: 'rgba(91,224,160,0.22)',
  cardBorder: 'rgba(0,0,0,0.55)',
  cardText: '#10131b',
} as const;

const COLOR_HEX: Record<ManaColor, string> = {
  W: '#efe7c4',
  U: '#4a86c5',
  B: '#6a6478',
  R: '#c75146',
  G: '#3a8f5d',
  C: '#a7b0c0',
};

export function manaColorHex(c: ManaColor): string {
  return COLOR_HEX[c];
}

// The card's "frame" color, by color identity.
export function cardBaseColor(def: CardDef): string {
  if (def.cost) {
    const colors = (['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]).filter((c) => (def.cost as Record<ManaColor, number>)[c] > 0);
    if (colors.length === 1) return COLOR_HEX[colors[0]];
    if (colors.length > 1) return '#cda84a'; // multicolor → gold
  }
  if (def.produces && def.produces.length > 0) return COLOR_HEX[def.produces[0]];
  return COLOR_HEX.C;
}

// Render a ManaCost back into a compact symbol string like "1R", "3WW".
export function costToString(def: CardDef): string {
  const c = def.cost;
  if (!c) return '';
  let s = c.generic > 0 ? String(c.generic) : '';
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    s += color.repeat((c as Record<ManaColor, number>)[color]);
  }
  return s;
}
