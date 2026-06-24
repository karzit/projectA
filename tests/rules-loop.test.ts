import { describe, expect, it } from 'vitest';
import { createGame, getDef, reduce } from '../src/rules/index.js';
import type { GameState, PlayerId } from '../src/rules/index.js';

// A 15-card deck of plain units (no conditions) so we can freely place/attack.
function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function game(): GameState {
  return createGame({ decks: { A: deck(), B: deck() } });
}

// Directly place a unit on a field (bypassing hand) for combat scenarios.
function place(s: GameState, player: PlayerId, cardId: string): string {
  const id = `u_${s.nextId++}`;
  const def = getDef(cardId);
  s.units[id] = {
    instanceId: id,
    cardId,
    owner: player,
    controller: player,
    keywords: [],
    power: def.power ?? 0,
    wisdom: def.wisdom ?? 0,
  };
  s.field[player].push(id);
  return id;
}

function act(s: GameState, action: Parameters<typeof reduce>[1]): GameState {
  const r = reduce(s, action);
  if (r.error) throw new Error(r.error);
  return r.state;
}

describe('opening phase', () => {
  it('both sides place up to 3, then the main phase begins with A', () => {
    let s = game();
    expect(s.phase).toBe('opening');
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (let i = 0; i < 3; i++) s = act(s, { type: 'placeOpening', player: p, cardId: 'stone-monkey' });
    }
    expect(s.phase).toBe('main');
    expect(s.active).toBe('A');
    expect(s.field.A.length).toBe(3);
    expect(s.field.B.length).toBe(3);
    expect(s.hand.A.length).toBe(12);
  });

  it('finishOpening lets a player stop early', () => {
    let s = game();
    s = act(s, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    s = act(s, { type: 'finishOpening', player: 'A' });
    s = act(s, { type: 'finishOpening', player: 'B' });
    expect(s.phase).toBe('main');
    expect(s.field.A.length).toBe(1);
  });

  it('rejects a 4th opening card', () => {
    let s = game();
    for (let i = 0; i < 3; i++) s = act(s, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    const r = reduce(s, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    expect(r.error).toBeTruthy();
  });
});

describe('main phase turns', () => {
  function toMain(): GameState {
    let s = game();
    s = act(s, { type: 'finishOpening', player: 'A' });
    s = act(s, { type: 'finishOpening', player: 'B' });
    return s;
  }

  it('a turn is one action, then it passes to the opponent', () => {
    let s = toMain();
    expect(s.active).toBe('A');
    s = act(s, { type: 'pass', player: 'A' });
    expect(s.active).toBe('B');
    s = act(s, { type: 'play', player: 'B', cardId: 'stone-monkey' });
    expect(s.active).toBe('A');
    expect(s.field.B.length).toBe(1);
  });

  it('rejects acting out of turn', () => {
    const s = toMain();
    expect(reduce(s, { type: 'pass', player: 'B' }).error).toBeTruthy();
  });

  it('blocks playing a card whose 배경 is unmet', () => {
    const s = toMain();
    // monkey-king needs 돌원숭이 + 지형:산; give A the card in hand but no conditions.
    s.hand.A.push('monkey-king');
    expect(reduce(s, { type: 'play', player: 'A', cardId: 'monkey-king' }).error).toBeTruthy();
  });
});

describe('power combat', () => {
  function toMain(): GameState {
    let s = game();
    s = act(s, { type: 'finishOpening', player: 'A' });
    s = act(s, { type: 'finishOpening', player: 'B' });
    return s;
  }

  it('higher power destroys lower power', () => {
    let s = toMain();
    // Forced-ability-free units so the post-action forced settle does not fire
    // (배신자 would betray itself as the lone highest unit — covered separately).
    const atk = place(s, 'A', 'monkey-king'); // power 6, no forced ability
    const def = place(s, 'B', 'stone-monkey'); // power 2
    s = act(s, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(s.units[def]).toBeUndefined();
    expect(s.units[atk]).toBeDefined();
    expect(s.field.B).not.toContain(def);
  });

  it('equal power destroys both', () => {
    let s = toMain();
    const atk = place(s, 'A', 'stone-monkey'); // power 2
    const def = place(s, 'B', 'stone-monkey'); // power 2
    s = act(s, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(s.units[atk]).toBeUndefined();
    expect(s.units[def]).toBeUndefined();
  });

  it('cannot attack your own unit', () => {
    const s = toMain();
    const a1 = place(s, 'A', 'traitor');
    const a2 = place(s, 'A', 'avenger');
    expect(reduce(s, { type: 'attack', player: 'A', attackerId: a1, targetId: a2 }).error).toBeTruthy();
  });
});

describe('loss condition', () => {
  it('emptying a side\'s field and hand ends the game', () => {
    let s = game();
    s = act(s, { type: 'finishOpening', player: 'A' });
    s = act(s, { type: 'finishOpening', player: 'B' });
    // Set up: B has a single unit and an empty hand; A destroys it.
    s.hand.B = [];
    const lone = place(s, 'B', 'stone-monkey'); // power 2
    const killer = place(s, 'A', 'traitor'); // power 5
    s = act(s, { type: 'attack', player: 'A', attackerId: killer, targetId: lone });
    expect(s.units[lone]).toBeUndefined();
    expect(s.loser).toBe('B'); // B has no field and no hand
  });
});
