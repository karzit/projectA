import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function toMain(seed = 1): Game {
  const g = new Game({ decks: { A: deck(), B: deck() }, seed });
  g.apply({ type: 'finishOpening', player: 'A' });
  g.apply({ type: 'finishOpening', player: 'B' });
  return g;
}

function place(g: Game, player: PlayerId, cardId: string): string {
  return g.board.summon(player, cardId);
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
}

describe('board operations (effect system)', () => {
  it('board.modifyStat changes a unit\'s stat', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey'); // 2/1
    g.board.modifyStat(u, 'power', 3);
    expect(g.state.units[u].power).toBe(5);
  });

  it('board.swapStats exchanges two units\' power and wisdom', () => {
    const g = toMain();
    const a = place(g, 'A', 'traitor');       // 5/5
    const b = place(g, 'A', 'stone-monkey');  // 2/1
    g.board.swapStats(a, b);
    expect([g.state.units[a].power, g.state.units[a].wisdom]).toEqual([2, 1]);
    expect([g.state.units[b].power, g.state.units[b].wisdom]).toEqual([5, 5]);
  });

  it('board.destroyUnit removes the unit and emits unitDied event', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey');
    g.board.destroyUnit(u);
    expect(g.state.units[u]).toBeUndefined();
    expect(g.state.field.A).not.toContain(u);
  });

  it('random pick is deterministic for a given seed', () => {
    const g = toMain(1);
    const ids = [
      place(g, 'A', 'stone-monkey'),
      place(g, 'A', 'stone-monkey'),
      place(g, 'A', 'stone-monkey'),
    ];
    const picked = g.board.pickRandom('ownField', 'A', 1);
    expect(picked.length).toBe(1);
    expect(ids).toContain(picked[0]);
  });

  it('혁명: repeat enemyUnitCount × swap of chosen pairs (end-to-end via play)', () => {
    const g = toMain();
    const t1 = place(g, 'A', 'traitor');
    place(g, 'A', 'traitor');
    place(g, 'A', 'traitor');       // wisdom 15, no power 7+
    const low = place(g, 'A', 'stone-monkey');
    place(g, 'B', 'stone-monkey'); // 1 enemy unit → 1 swap
    g.state.hand.A.push('revolution');

    act(g, { type: 'play', player: 'A', cardId: 'revolution', choices: [t1, low] });
    expect(g.state.hand.A).not.toContain('revolution');
    act(g, { type: 'pass', player: 'A' }); // 효과는 턴 종료 시 처리
    expect([g.state.units[t1].power, g.state.units[t1].wisdom]).toEqual([2, 1]);
    expect([g.state.units[low].power, g.state.units[low].wisdom]).toEqual([5, 5]);
  });

  it('혁명 is blocked when 배경 (wisdom / power) is unmet', () => {
    const g = toMain();
    place(g, 'A', 'avenger'); // 지혜 2 only
    g.state.hand.A.push('revolution');
    expect(g.apply({ type: 'play', player: 'A', cardId: 'revolution', choices: [] }).error).toBeTruthy();
  });
});
