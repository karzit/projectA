import { describe, expect, it } from 'vitest';
import { createGame, getDef, performRitual, reduce } from '../src/rules/index.js';
import type { GameState, PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

// Build a game already in the main phase with both fields empty.
function toMain(seed = 1): GameState {
  let s = createGame({ decks: { A: deck(), B: deck() }, seed });
  s = reduce(s, { type: 'finishOpening', player: 'A' }).state;
  s = reduce(s, { type: 'finishOpening', player: 'B' }).state;
  return s;
}

function place(s: GameState, player: PlayerId, cardId: string): string {
  const id = `u_${s.nextId++}`;
  const def = getDef(cardId);
  s.units[id] = {
    instanceId: id,
    cardId,
    owner: player,
    controller: player,
    keywords: def.allKeywords ? ['*'] : [...(def.keywords ?? [])],
    power: def.power ?? 0,
    wisdom: def.wisdom ?? 0,
  };
  s.field[player].push(id);
  return id;
}

describe('forced abilities — settle loop', () => {
  it('복수자: rises from hand when its side has an empty field', () => {
    const s = toMain();
    s.hand.A = ['avenger']; // 복수자 in hand, A's field empty
    // Any main-phase action settles the board; A passes.
    const ns = reduce(s, { type: 'pass', player: 'A' }).state;
    expect(ns.field.A.length).toBe(1);
    expect(getDef(ns.units[ns.field.A[0]].cardId).name).toBe('복수자');
    expect(ns.hand.A).not.toContain('avenger'); // summoned out of hand
  });

  it('복수자: does NOT rise while a unit is already on its field', () => {
    const s = toMain();
    s.hand.A = ['avenger'];
    place(s, 'A', 'stone-monkey'); // field not empty
    const ns = reduce(s, { type: 'pass', player: 'A' }).state;
    expect(ns.field.A.length).toBe(1); // still just the monkey; avenger stayed in hand
    expect(ns.hand.A).toContain('avenger');
  });

  it('배신자: as the highest 힘 AND 지혜 on its side, kills an ally and defects', () => {
    const s = toMain(); // seed 1 → the random sacrifice falls on the monkey
    s.hand.A = []; // isolate the forced effect from loss bookkeeping
    s.hand.B = [];
    const traitor = place(s, 'A', 'traitor'); // 5/5 — tops both stats
    const monkey = place(s, 'A', 'stone-monkey'); // 2/1 — the sacrificed ally
    const ns = reduce(s, { type: 'pass', player: 'A' }).state;

    expect(ns.units[monkey]).toBeUndefined(); // random ally destroyed
    expect(ns.units[traitor].controller).toBe('B'); // traitor defected
    expect(ns.field.B).toContain(traitor);
    expect(ns.field.A).not.toContain(traitor);
  });

  it('배신자: fires only once (its ability is once-per-game)', () => {
    const s = toMain();
    place(s, 'A', 'traitor');
    place(s, 'A', 'stone-monkey');
    const ns = reduce(s, { type: 'pass', player: 'A' }).state;
    expect(ns.firedForced.some((k) => k.endsWith(':betray'))).toBe(true);
  });

  it('마왕: descends from hand once the 부활 의식 ritual reaches 5', () => {
    const s = toMain();
    s.hand.B = ['demon-king']; // 소환 불가 by normal play; only descends
    for (let i = 0; i < 5; i++) performRitual(s, '부활의식');
    const ns = reduce(s, { type: 'pass', player: 'A' }).state;
    expect(ns.field.B.some((id) => ns.units[id].cardId === 'demon-king')).toBe(true);
    expect(ns.hand.B).not.toContain('demon-king');
  });

  it('마왕: stays in hand until the ritual is complete', () => {
    const s = toMain();
    s.hand.B = ['demon-king'];
    for (let i = 0; i < 4; i++) performRitual(s, '부활의식'); // one short
    const ns = reduce(s, { type: 'pass', player: 'A' }).state;
    expect(ns.field.B.length).toBe(0);
    expect(ns.hand.B).toContain('demon-king');
  });
});
