// Shared layout contract for the rules client. Produces screen rectangles for
// every visible card from a rules GameState. Both the renderer and interaction
// layer consume this — what you see is exactly what you can click.
//
// Perspective: localPlayer sits at the bottom; the opponent at the top.

import { CARD } from './theme.js';
import type { GameState, PlayerId } from '../../rules/index.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardView {
  // Stable unique key for this visual slot (instanceId for field units,
  // `hand:P:N` for hand cards). Used as the animation/hit-test key.
  key: string;
  cardId: string;        // card definition ID — pass to getDef() and CardSprite
  instanceId?: string;   // defined only for field units
  handIndex?: number;    // defined only for hand cards
  x: number;
  y: number;
  w: number;
  h: number;
  zone: 'field' | 'hand';
  controller: PlayerId;
  faceUp: boolean;
}

export type RegionName = 'oppHand' | 'oppField' | 'localField' | 'localHand';

export interface BoardLayout {
  cards: CardView[];
  regions: Record<RegionName, Rect>;
  localPlayer: PlayerId;
}

const M = 16; // outer margin

function placeRow(
  entries: Array<{ key: string; cardId: string; instanceId?: string; handIndex?: number }>,
  controller: PlayerId,
  zone: 'field' | 'hand',
  y: number,
  viewportW: number,
  faceUp: boolean,
): CardView[] {
  const n = entries.length;
  if (n === 0) return [];
  // When many cards don't fit at full spacing, compress the step so they fan/overlap.
  // The last card always renders fully; earlier cards peek out from underneath.
  const maxStep = CARD.w + CARD.gap;
  const availW = viewportW - CARD.w - 2 * M;
  const step = n <= 1 ? maxStep : Math.min(maxStep, availW / (n - 1));
  const totalW = CARD.w + (n - 1) * step;
  const startX = Math.max(M, (viewportW - totalW) / 2);
  return entries.map((e, i) => ({
    key: e.key,
    cardId: e.cardId,
    instanceId: e.instanceId,
    handIndex: e.handIndex,
    x: startX + i * step,
    y,
    w: CARD.w,
    h: CARD.h,
    zone,
    controller,
    faceUp,
  }));
}

export function layout(
  state: GameState,
  viewport: { width: number; height: number },
  localPlayer: PlayerId,
): BoardLayout {
  const opp: PlayerId = localPlayer === 'A' ? 'B' : 'A';
  const vw = viewport.width;
  const vh = viewport.height;

  const rows = {
    oppHand:   M,
    oppField:  M + CARD.h + M,
    localField: vh - 2 * (CARD.h + M),
    localHand:  vh - CARD.h - M,
  };

  const regions: Record<RegionName, Rect> = {
    oppHand:    { x: 0, y: rows.oppHand,    w: vw, h: CARD.h },
    oppField:   { x: 0, y: rows.oppField,   w: vw, h: CARD.h },
    localField: { x: 0, y: rows.localField, w: vw, h: CARD.h },
    localHand:  { x: 0, y: rows.localHand,  w: vw, h: CARD.h },
  };

  const cards: CardView[] = [];

  // Opponent hand: face-down (card backs), keyed by position.
  const oppHandEntries = state.hand[opp].map((cardId, i) => ({
    key: `hand:${opp}:${i}`,
    cardId,
    handIndex: i,
  }));
  cards.push(...placeRow(oppHandEntries, opp, 'hand', rows.oppHand, vw, false));

  // Opponent field: face-up field units.
  const oppFieldEntries = state.field[opp].map((id) => ({
    key: id,
    cardId: state.units[id]?.cardId ?? id,
    instanceId: id,
  }));
  cards.push(...placeRow(oppFieldEntries, opp, 'field', rows.oppField, vw, true));

  // Local field.
  const localFieldEntries = state.field[localPlayer].map((id) => ({
    key: id,
    cardId: state.units[id]?.cardId ?? id,
    instanceId: id,
  }));
  cards.push(...placeRow(localFieldEntries, localPlayer, 'field', rows.localField, vw, true));

  // Local hand: face-up.
  const localHandEntries = state.hand[localPlayer].map((cardId, i) => ({
    key: `hand:${localPlayer}:${i}`,
    cardId,
    handIndex: i,
  }));
  cards.push(...placeRow(localHandEntries, localPlayer, 'hand', rows.localHand, vw, true));

  return { cards, regions, localPlayer };
}

export function hitTestCard(lo: BoardLayout, x: number, y: number): CardView | null {
  for (let i = lo.cards.length - 1; i >= 0; i--) {
    const c = lo.cards[i];
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c;
  }
  return null;
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
