// Visual constants and color helpers shared by the renderer.

import type { CardMeta } from '../../rules/index.js';

export const CARD = { w: 92, h: 128, radius: 9, gap: 12 } as const;

export const UI = {
  bg: '#070b16',
  region: 'rgba(255,255,255,0.035)',
  regionLine: 'rgba(255,255,255,0.08)',
  text: '#e9edf6',
  sub: '#9aa6bd',
  hover: '#7fd1ff',
  arrow: '#ff5470',
  selected: '#ffd060',
  drop: '#5be0a0',
  dropFill: 'rgba(91,224,160,0.10)',
  dropFillActive: 'rgba(91,224,160,0.22)',
  cardBorder: 'rgba(0,0,0,0.55)',
  cardText: '#10131b',
} as const;

const KIND_COLOR: Record<string, string> = {
  unit: '#3a5a8a',
  spell: '#5a3a8a',
};

export function cardBaseColor(meta: CardMeta): string {
  return KIND_COLOR[meta.kind] ?? '#3a3a5a';
}
