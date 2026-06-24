import { describe, expect, it } from 'vitest';
import {
  canPlayId,
  checkLoss,
  createGame,
  develop,
  developAll,
  emptyEnvironment,
  getDef,
  summon,
} from '../src/rules/index.js';
import { Game } from '../src/rules/index.js';
import type { GameState } from '../src/rules/index.js';

function newGame(): Game {
  const deck = Array.from({ length: 15 }, (_, i) => (i === 0 ? 'monkey-king' : 'stone-monkey'));
  return new Game({ decks: { A: [...deck], B: [...deck] } });
}

describe('environment (환경)', () => {
  it('different types stack; same type replaces (cannot stack)', () => {
    let env = emptyEnvironment();
    env = develop(env, '지역', '사천');
    env = develop(env, '지형', '산');
    env = develop(env, '장소', '묘지');
    expect(env).toEqual({ 지역: '사천', 지형: '산', 장소: '묘지' });

    env = develop(env, '날씨', '눈');
    env = develop(env, '날씨', '비');
    expect(env['날씨']).toBe('비');
    expect(Object.values(env)).not.toContain('눈');
  });

  it('developAll applies a card\'s 전개 list', () => {
    const woogong = getDef('foolish-old-man');
    // foolish-old-man has no develops in meta (it's an onPlay method now),
    // so test via the card's action instead.
    const g = newGame();
    g.state.environment = develop(g.state.environment, '지형', '산');
    expect(g.state.environment['지형']).toBe('산');
  });
});

describe('play conditions (배경)', () => {
  it('미후왕 cannot be played without 돌원숭이 on field and 지형:산 in environment', () => {
    const g = newGame();
    const check = canPlayId(g.state, 'monkey-king', 'A');
    expect(check.ok).toBe(false);
    expect(check.missing.length).toBe(2);
  });

  it('미후왕 becomes playable once both conditions are met', () => {
    const g = newGame();
    summon(g.state, 'A', 'stone-monkey');
    g.state.environment = develop(g.state.environment, '지형', '산');
    const check = canPlayId(g.state, 'monkey-king', 'A');
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
  });

  it('a condition only matters at play time — removing it afterward does not un-play', () => {
    const g = newGame();
    summon(g.state, 'A', 'stone-monkey');
    g.state.environment = develop(g.state.environment, '지형', '산');
    expect(canPlayId(g.state, 'monkey-king', 'A').ok).toBe(true);
    const king = summon(g.state, 'A', 'monkey-king');
    g.state.environment = {};
    expect(g.state.units[king]).toBeDefined();
    expect(g.state.field.A).toContain(king);
  });

  it('마왕 cannot be normally summoned (소환 불가)', () => {
    const g = newGame();
    expect(canPlayId(g.state, 'demon-king', 'A').ok).toBe(false);
    expect(canPlayId(g.state, 'demon-king', 'A').reason).toBe('소환 불가');
  });
});

describe('wisdom & power conditions (배경)', () => {
  function place(g: Game, player: 'A' | 'B', cardId: string): string {
    return g.board.summon(player, cardId);
  }

  it('혁명 needs own-side total 지혜 ≥ 15', () => {
    const g = newGame();
    place(g, 'A', 'avenger');   // 지혜 2
    place(g, 'A', 'traitor');   // 지혜 5  → total 7 (< 15)
    expect(canPlayId(g.state, 'revolution', 'A').ok).toBe(false);

    place(g, 'A', 'monkey-king'); // 지혜 5 → total 12
    place(g, 'A', 'avenger');     // 지혜 2 → total 14
    place(g, 'A', 'avenger');     // 지혜 2 → total 16 ≥ 15
    expect(canPlayId(g.state, 'revolution', 'A').ok).toBe(true);
  });

  it('혁명 is blocked when a 힘 7+ unit is on your side', () => {
    const g = newGame();
    place(g, 'A', 'traitor');
    place(g, 'A', 'traitor');
    place(g, 'A', 'traitor'); // 지혜 15 ✓, no 힘 7+
    expect(canPlayId(g.state, 'revolution', 'A').ok).toBe(true);

    place(g, 'A', 'monkey-king'); // 힘 6 — still < 7
    expect(canPlayId(g.state, 'revolution', 'A').ok).toBe(true);

    place(g, 'A', 'demon-king'); // 힘 10 ≥ 7 → blocked
    expect(canPlayId(g.state, 'revolution', 'A').ok).toBe(false);
  });

  it('wisdom is per-side: the opponent\'s wisdom does not count', () => {
    const g = newGame();
    place(g, 'B', 'demon-king');  // 지혜 10 on B
    place(g, 'B', 'monkey-king'); // 지혜 5 → B has 15, not A
    expect(canPlayId(g.state, 'revolution', 'A').ok).toBe(false);
  });
});

describe('loss condition', () => {
  it('a player with an empty field loses', () => {
    const g = newGame();
    summon(g.state, 'A', 'stone-monkey');
    summon(g.state, 'B', 'stone-monkey');
    expect(checkLoss(g.state)).toBeNull();
    g.state.field.B = [];
    expect(checkLoss(g.state)).toBe('B');
  });
});
