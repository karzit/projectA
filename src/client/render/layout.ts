// The shared layout contract. Given a GameState and a viewport, produce the
// on-screen rectangle for every visible card. BOTH the renderer (to draw) and
// the interaction layer (to hit-test) consume this — so what you see is exactly
// what you can click, with no drift between the two.
//
// Perspective: `localPlayer` sits at the bottom; the opponent at the top.

import { CARD } from './theme.js';
import type { GameState, PlayerId, ZoneName } from '../../engine/index.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardView {
  instanceId: string;
  oracleId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zone: ZoneName;
  controller: PlayerId;
  faceUp: boolean;
  tapped: boolean;
}

export type RegionName = 'p1Hand' | 'p1Field' | 'p0Field' | 'p0Hand' | 'stack';

// A single object on the stack — a spell (rendered as its card) or a triggered
// ability (rendered as a token). `top` marks the object that resolves next.
export interface StackItemView {
  key: string; // instanceId for a spell, stackId for an ability (animation key)
  kind: 'spell' | 'ability';
  oracleId: string;
  controller: PlayerId;
  x: number;
  y: number;
  w: number;
  h: number;
  top: boolean;
}

export interface BoardLayout {
  cards: CardView[];
  stack: StackItemView[];
  regions: Record<RegionName, Rect>;
  localPlayer: PlayerId;
}

const M = 16; // outer margin between rows

function placeRow(
  ids: string[],
  state: GameState,
  y: number,
  viewportW: number,
  zone: ZoneName,
  faceUpFor: (id: string) => boolean,
): CardView[] {
  const n = ids.length;
  if (n === 0) return [];
  const totalW = n * CARD.w + (n - 1) * CARD.gap;
  const startX = Math.max(M, (viewportW - totalW) / 2);
  return ids.map((id, i) => {
    const c = state.cards[id];
    return {
      instanceId: id,
      oracleId: c.oracleId,
      x: startX + i * (CARD.w + CARD.gap),
      y,
      w: CARD.w,
      h: CARD.h,
      zone,
      controller: c.controller,
      faceUp: faceUpFor(id),
      tapped: c.tapped,
    };
  });
}

export function layout(state: GameState, viewport: { width: number; height: number }, localPlayer: PlayerId): BoardLayout {
  const opp: PlayerId = localPlayer === 'P0' ? 'P1' : 'P0';
  const vw = viewport.width;
  const vh = viewport.height;

  const rows = {
    p1Hand: M,
    p1Field: M + CARD.h + M,
    p0Field: vh - 2 * (CARD.h + M),
    p0Hand: vh - CARD.h - M,
  };

  const regions: Record<RegionName, Rect> = {
    p1Hand: { x: 0, y: rows.p1Hand, w: vw, h: CARD.h },
    p1Field: { x: 0, y: rows.p1Field, w: vw, h: CARD.h },
    p0Field: { x: 0, y: rows.p0Field, w: vw, h: CARD.h },
    p0Hand: { x: 0, y: rows.p0Hand, w: vw, h: CARD.h },
    stack: { x: vw - CARD.w - M, y: vh / 2 - CARD.h / 2, w: CARD.w, h: CARD.h },
  };

  const cards: CardView[] = [];

  // Opponent hand: rendered face-down, one back per card.
  cards.push(...placeRow(state.zones[opp].hand, state, rows.p1Hand, vw, 'hand', () => false));
  // Opponent battlefield (public).
  cards.push(...placeRow(state.zones[opp].battlefield, state, rows.p1Field, vw, 'battlefield', () => true));
  // Local battlefield (public).
  cards.push(...placeRow(state.zones[localPlayer].battlefield, state, rows.p0Field, vw, 'battlefield', () => true));
  // Local hand: face-up.
  cards.push(...placeRow(state.zones[localPlayer].hand, state, rows.p0Hand, vw, 'hand', () => true));

  // The stack: a vertical fan in the stack region, the top object (which
  // resolves next) highest on screen.
  const stack: StackItemView[] = [];
  const n = state.stack.length;
  state.stack.forEach((obj, i) => {
    const fromTop = n - 1 - i; // 0 = top of stack
    stack.push({
      key: obj.cardInstanceId ?? obj.id,
      kind: obj.kind,
      oracleId: obj.oracleId,
      controller: obj.controller,
      x: regions.stack.x - fromTop * 6,
      y: regions.stack.y + fromTop * 30,
      w: CARD.w,
      h: CARD.h,
      top: i === n - 1,
    });
  });

  return { cards, stack, regions, localPlayer };
}

// Topmost card under a point (last drawn wins). Tapped cards are hit-tested by
// their upright box, which is a close-enough approximation.
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
