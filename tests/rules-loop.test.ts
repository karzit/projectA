import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function mixedDeck(): string[] {
  return ['foolish-old-man', ...Array.from({ length: 14 }, () => 'stone-monkey')];
}

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function game(): Game {
  return new Game({ decks: { A: deck(), B: deck() } });
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
}

// Directly place a unit on a field (bypassing hand) for combat scenarios.
function place(g: Game, player: PlayerId, cardId: string): string {
  return g.board.summon(player, cardId);
}

describe('opening phase', () => {
  it('both sides place up to 3, then the main phase begins with A', () => {
    const g = game();
    expect(g.state.phase).toBe('opening');
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (let i = 0; i < 3; i++) act(g, { type: 'placeOpening', player: p, cardId: 'stone-monkey' });
    }
    expect(g.state.phase).toBe('main');
    expect(g.state.active).toBe('A');
    expect(g.state.field.A.length).toBe(3);
    expect(g.state.field.B.length).toBe(3);
    expect(g.state.hand.A.length).toBe(12);
  });

  it('finishOpening lets a player stop early', () => {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    expect(g.state.phase).toBe('main');
    expect(g.state.field.A.length).toBe(1);
  });

  it('rejects a 4th opening card', () => {
    const g = game();
    for (let i = 0; i < 3; i++) act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    expect(g.apply({ type: 'placeOpening', player: 'A', cardId: 'stone-monkey' }).error).toBeTruthy();
  });

  it('opening effects are deferred — environment not changed until opening ends', () => {
    const g = new Game({ decks: { A: mixedDeck(), B: deck() } });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'foolish-old-man' });
    expect(g.state.environment['지형']).toBeUndefined();
    act(g, { type: 'finishOpening', player: 'A' });
    expect(g.state.environment['지형']).toBeUndefined();
    act(g, { type: 'finishOpening', player: 'B' });
    expect(g.state.phase).toBe('main');
    expect(g.state.environment['지형']).toBe('산');
  });

  it('opening unit is on field immediately for 배경 conditions of subsequent placements', () => {
    const g = new Game({ decks: { A: ['stone-monkey', 'monkey-king', ...Array.from({length:13},()=>'stone-monkey')], B: deck() } });
    g.state.environment['지형'] = '산';
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    expect(() => act(g, { type: 'placeOpening', player: 'A', cardId: 'monkey-king' })).not.toThrow();
  });

  it('opening effects resolve A first, then B (선턴 이점)', () => {
    const g = new Game({
      decks: { A: mixedDeck(), B: ['foolish-old-man', ...Array.from({length:14},()=>'stone-monkey')] },
    });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'foolish-old-man' });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'foolish-old-man' });
    expect(g.state.environment['지형']).toBeUndefined();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    expect(g.state.phase).toBe('main');
    expect(g.state.environment['지형']).toBe('산');
  });
});

describe('main phase turns', () => {
  function toMain(): Game {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey' });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  it('pass ends the turn; play and attack do not', () => {
    const g = toMain();
    expect(g.state.active).toBe('A');
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.active).toBe('B');
    act(g, { type: 'play', player: 'B', cardId: 'stone-monkey' });
    expect(g.state.active).toBe('B');
    expect(g.state.field.B.length).toBe(2);
    act(g, { type: 'pass', player: 'B' });
    expect(g.state.active).toBe('A');
  });

  it('cannot play a second card in the same turn', () => {
    const g = toMain();
    act(g, { type: 'play', player: 'A', cardId: 'stone-monkey' });
    expect(g.apply({ type: 'play', player: 'A', cardId: 'stone-monkey' }).error).toBeTruthy();
  });

  it('each unit can attack once per turn; same unit cannot attack twice', () => {
    const g = toMain();
    const atk = place(g, 'A', 'monkey-king'); // power 6
    const def1 = place(g, 'B', 'stone-monkey');
    const def2 = place(g, 'B', 'stone-monkey');
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def1 });
    expect(g.state.units[def1]).toBeUndefined();
    expect(g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def2 }).error).toBeTruthy();
  });

  it('different units can each attack once in the same turn', () => {
    const g = toMain();
    const atk1 = place(g, 'A', 'monkey-king');
    const atk2 = place(g, 'A', 'monkey-king');
    const def1 = place(g, 'B', 'stone-monkey');
    const def2 = place(g, 'B', 'stone-monkey');
    act(g, { type: 'attack', player: 'A', attackerId: atk1, targetId: def1 });
    act(g, { type: 'attack', player: 'A', attackerId: atk2, targetId: def2 });
    expect(g.state.units[def1]).toBeUndefined();
    expect(g.state.units[def2]).toBeUndefined();
    expect(g.state.active).toBe('A');
  });

  it('rejects acting out of turn', () => {
    const g = toMain();
    expect(g.apply({ type: 'pass', player: 'B' }).error).toBeTruthy();
  });

  it('blocks playing a card whose 배경 is unmet', () => {
    const g = toMain();
    g.state.hand.A.push('monkey-king');
    expect(g.apply({ type: 'play', player: 'A', cardId: 'monkey-king' }).error).toBeTruthy();
  });
});

describe('power combat', () => {
  function toMain(): Game {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey' });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey' });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  it('higher power destroys lower power', () => {
    const g = toMain();
    const atk = place(g, 'A', 'monkey-king');
    const def = place(g, 'B', 'stone-monkey');
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(g.state.units[def]).toBeUndefined();
    expect(g.state.units[atk]).toBeDefined();
    expect(g.state.field.B).not.toContain(def);
  });

  it('equal power destroys both', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    const def = place(g, 'B', 'stone-monkey');
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(g.state.units[atk]).toBeUndefined();
    expect(g.state.units[def]).toBeUndefined();
  });

  it('cannot attack your own unit', () => {
    const g = toMain();
    const a1 = place(g, 'A', 'traitor');
    const a2 = place(g, 'A', 'avenger');
    expect(g.apply({ type: 'attack', player: 'A', attackerId: a1, targetId: a2 }).error).toBeTruthy();
  });
});

describe('loss condition', () => {
  it('emptying a side\'s field at turn end causes a loss', () => {
    const g = game();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    const lone = place(g, 'B', 'stone-monkey');
    const killer = place(g, 'A', 'monkey-king');
    g.state.field.B = [lone];
    act(g, { type: 'attack', player: 'A', attackerId: killer, targetId: lone });
    expect(g.state.units[lone]).toBeUndefined();
    expect(g.state.loser).toBeNull();
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.loser).toBe('B');
  });
});
