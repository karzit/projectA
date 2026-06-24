import { describe, expect, it } from 'vitest';
import { createGame, getDef, newContext, reduce, resolveEffects } from '../src/rules/index.js';
import type { GameState, PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function toMain(): GameState {
  let s = createGame({ decks: { A: deck(), B: deck() }, seed: 1 });
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
    keywords: [],
    power: def.power ?? 0,
    wisdom: def.wisdom ?? 0,
  };
  s.field[player].push(id);
  return id;
}

describe('effect interpreter', () => {
  it('modifyStat over a field selector, then destroy via self selector', () => {
    const s = toMain();
    const u = place(s, 'A', 'stone-monkey'); // 2/1
    resolveEffects(s, [{ do: 'modifyStat', target: { kind: 'ownField' }, stat: 'power', amount: 3 }], newContext('A', 'x'));
    expect(s.units[u].power).toBe(5);

    resolveEffects(s, [{ do: 'destroy', target: { kind: 'self' } }], newContext('A', 'x', [], u));
    expect(s.units[u]).toBeUndefined();
    expect(s.field.A).not.toContain(u);
  });

  it('swapStats exchanges two units\' power and wisdom', () => {
    const s = toMain();
    const a = place(s, 'A', 'traitor'); // 5/5
    const b = place(s, 'A', 'stone-monkey'); // 2/1
    resolveEffects(
      s,
      [{ do: 'swapStats', a: { kind: 'chosen', count: 1 }, b: { kind: 'chosen', count: 1 } }],
      newContext('A', 'x', [a, b]),
    );
    expect([s.units[a].power, s.units[a].wisdom]).toEqual([2, 1]);
    expect([s.units[b].power, s.units[b].wisdom]).toEqual([5, 5]);
  });

  it('random destroy is deterministic for a given seed', () => {
    const s = toMain();
    const ids = [place(s, 'A', 'stone-monkey'), place(s, 'A', 'stone-monkey'), place(s, 'A', 'stone-monkey')];
    resolveEffects(s, [{ do: 'destroy', target: { kind: 'random', from: 'ownField', count: 1 } }], newContext('A', 'x'));
    const remaining = ids.filter((id) => s.units[id]);
    expect(remaining.length).toBe(2); // exactly one destroyed
  });

  it('혁명: repeat enemyUnitCount × swap of chosen pairs (end-to-end via play)', () => {
    const s = toMain();
    // A's side: total 지혜 ≥ 15, no 힘 7+ (three traitors: 5/5 each → 지혜 15, 힘 5).
    const t1 = place(s, 'A', 'traitor');
    place(s, 'A', 'traitor');
    place(s, 'A', 'traitor');
    const low = place(s, 'A', 'stone-monkey'); // 2/1 — the swap partner
    place(s, 'B', 'stone-monkey'); // 1 enemy unit → enemyUnitCount = 1 → one swap
    s.hand.A.push('revolution');

    const r = reduce(s, { type: 'play', player: 'A', cardId: 'revolution', choices: [t1, low] });
    expect(r.error).toBeUndefined();
    const ns = r.state;
    expect([ns.units[t1].power, ns.units[t1].wisdom]).toEqual([2, 1]); // got low's stats
    expect([ns.units[low].power, ns.units[low].wisdom]).toEqual([5, 5]); // got t1's stats
    expect(ns.hand.A).not.toContain('revolution'); // the spell was played
  });

  it('혁명 is blocked when 배경 (wisdom / power) is unmet', () => {
    const s = toMain();
    place(s, 'A', 'avenger'); // 지혜 2 only
    s.hand.A.push('revolution');
    expect(reduce(s, { type: 'play', player: 'A', cardId: 'revolution', choices: [] }).error).toBeTruthy();
  });
});
