// Shared layout contract for the rules client. Produces screen rectangles for
// every visible card from a rules GameState. Both the renderer and interaction
// layer consume this — what you see is exactly what you can click.
//
// Perspective: localPlayer sits at the bottom; the opponent at the top.
//
// Grid layout (per player):
//   Back row  (후열, cells 5-8): 4 hex cells, offset half a card width
//   Front row (전열, cells 0-4): 5 hex cells
//
// From local player's perspective (bottom):
//   [localHand]       ← local hand
//   [localBack]       ← local back row  (cells 5-8, farther from opponent)
//   [localFront]      ← local front row (cells 0-4, closer to opponent)
//   ────── center ──────
//   [oppFront]        ← opponent front row (cells 0-4)
//   [oppBack]         ← opponent back row  (cells 5-8)
//   [oppHand]         ← opponent hand

import { CARD } from './theme.js';
import { isHandSlotLocked } from '../../rules/index.js';
import type { GameState, PlayerId } from '../../rules/index.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardView {
  key: string;
  cardId: string;
  instanceId?: string;
  handIndex?: number;
  cell?: number;      // grid cell index (0-8) for field units
  x: number;
  y: number;
  w: number;
  h: number;
  zone: 'field' | 'hand';
  controller: PlayerId;
  faceUp: boolean;
  locked?: boolean;  // hand card locked by 패악질/지략 this turn
}

export type RegionName = 'oppHand' | 'oppFrontField' | 'oppBackField' | 'localFrontField' | 'localBackField' | 'localHand';

export interface BoardLayout {
  cards: CardView[];
  regions: Record<RegionName, Rect>;
  localPlayer: PlayerId;
}

const M = 16;             // outer margin
const ROW_GAP = 6;        // vertical gap between front/back rows

// Compute x positions for a hex row. Front row has 5 cells, back row has 4
// cells offset by half a step (the hex stagger).
//
// step = cardW + gap
// Front cell i:  x = startX + i * step
// Back  cell j:  x = startX + (j + 0.5) * step
//
function hexRowPositions(count: number, offset: boolean, viewportW: number): number[] {
  const step = CARD.w + CARD.gap;
  const totalFront = 5 * step - CARD.gap; // width of 5-cell front row
  const startX = Math.max(M, (viewportW - totalFront) / 2);
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(startX + (offset ? i + 0.5 : i) * step);
  }
  return positions;
}

// Build CardView entries for a hex grid row (field units only).
function placeHexRow(
  field: (string | null)[],   // 9-slot field array
  cellIndices: readonly number[], // which cells this row covers
  state: GameState,
  controller: PlayerId,
  zone: 'field',
  y: number,
  viewportW: number,
  faceUp: boolean,
  offset: boolean,
): CardView[] {
  const xPositions = hexRowPositions(cellIndices.length, offset, viewportW);
  const views: CardView[] = [];
  cellIndices.forEach((cell, i) => {
    const id = field[cell];
    if (!id) return;
    views.push({
      key: id,
      cardId: state.units[id]?.cardId ?? id,
      instanceId: id,
      cell,
      x: xPositions[i],
      y,
      w: CARD.w,
      h: CARD.h,
      zone,
      controller,
      faceUp,
    });
  });
  return views;
}

// Build CardView entries for the hand row.
function placeHandRow(
  handIds: string[],
  controller: PlayerId,
  y: number,
  viewportW: number,
  faceUp: boolean,
  state?: GameState,
): CardView[] {
  const n = handIds.length;
  if (n === 0) return [];
  const maxStep = CARD.w + CARD.gap;
  const availW = viewportW - CARD.w - 2 * M;
  const step = n <= 1 ? maxStep : Math.min(maxStep, availW / (n - 1));
  const totalW = CARD.w + (n - 1) * step;
  const startX = Math.max(M, (viewportW - totalW) / 2);
  return handIds.map((cardId, i) => ({
    key: `hand:${controller}:${i}`,
    cardId,
    handIndex: i,
    x: startX + i * step,
    y,
    w: CARD.w,
    h: CARD.h,
    zone: 'hand',
    controller,
    faceUp,
    locked: state ? isHandSlotLocked(state, controller, i) : false,
  }));
}

const FRONT_CELLS = [0, 1, 2, 3, 4] as const;
const BACK_CELLS  = [5, 6, 7, 8]    as const;

// Returns the 9 cell rects (cells 0-8) for a player side, given y positions.
// Used by the renderer to draw empty cell slots.
export function hexCellRects(
  frontY: number,
  backY: number,
  viewportW: number,
): Rect[] {
  const frontXs = hexRowPositions(5, false, viewportW);
  const backXs  = hexRowPositions(4, true,  viewportW);
  const rects: Rect[] = [];
  for (const x of frontXs) rects.push({ x, y: frontY, w: CARD.w, h: CARD.h });
  for (const x of backXs)  rects.push({ x, y: backY,  w: CARD.w, h: CARD.h });
  return rects; // rects[0..4] = front cells 0-4, rects[5..8] = back cells 5-8
}

export function layout(
  state: GameState,
  viewport: { width: number; height: number },
  localPlayer: PlayerId,
): BoardLayout {
  const opp: PlayerId = localPlayer === 'A' ? 'B' : 'A';
  const vw = viewport.width;
  const vh = viewport.height;

  // Vertical layout (top → bottom):
  //  oppHand / oppBack / oppFront / [center] / localFront / localBack / localHand
  const rowH = CARD.h;

  const rows = {
    oppHand:        M,
    oppBack:        M + rowH + ROW_GAP,
    oppFront:       M + (rowH + ROW_GAP) * 2,
    localFront:     vh - M - (rowH + ROW_GAP) * 3,
    localBack:      vh - M - (rowH + ROW_GAP) * 2,
    localHand:      vh - M - rowH,
  };

  const regions: Record<RegionName, Rect> = {
    oppHand:        { x: 0, y: rows.oppHand,    w: vw, h: rowH },
    oppBackField:   { x: 0, y: rows.oppBack,    w: vw, h: rowH },
    oppFrontField:  { x: 0, y: rows.oppFront,   w: vw, h: rowH },
    localFrontField:{ x: 0, y: rows.localFront, w: vw, h: rowH },
    localBackField: { x: 0, y: rows.localBack,  w: vw, h: rowH },
    localHand:      { x: 0, y: rows.localHand,  w: vw, h: rowH },
  };

  const cards: CardView[] = [];
  const oppFaceUp = state.phase !== 'opening';

  // Opponent hand (face-down).
  cards.push(...placeHandRow(
    state.hand[opp].map((_, i) => `hand:${opp}:${i}` as string).map((_k, i) => state.hand[opp][i]),
    opp, rows.oppHand, vw, false,
  ));

  // Opponent back row (cells 5-8) — offset half-step.
  cards.push(...placeHexRow(state.field[opp], BACK_CELLS, state, opp, 'field', rows.oppBack, vw, oppFaceUp, true));

  // Opponent front row (cells 0-4).
  cards.push(...placeHexRow(state.field[opp], FRONT_CELLS, state, opp, 'field', rows.oppFront, vw, oppFaceUp, false));

  // Local front row (cells 0-4).
  cards.push(...placeHexRow(state.field[localPlayer], FRONT_CELLS, state, localPlayer, 'field', rows.localFront, vw, true, false));

  // Local back row (cells 5-8) — offset half-step.
  cards.push(...placeHexRow(state.field[localPlayer], BACK_CELLS, state, localPlayer, 'field', rows.localBack, vw, true, true));

  // Local hand (face-up).
  cards.push(...placeHandRow(state.hand[localPlayer], localPlayer, rows.localHand, vw, true, state));

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
