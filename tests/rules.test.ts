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
import type { GameState } from '../src/rules/index.js';

function newGame(): GameState {
  // 15-card decks (contents don't matter for these unit tests).
  const deck = Array.from({ length: 15 }, (_, i) => (i === 0 ? 'monkey-king' : 'stone-monkey'));
  return createGame({ decks: { A: [...deck], B: [...deck] } });
}

describe('environment (환경)', () => {
  it('different types stack; same type replaces (cannot stack)', () => {
    let env = emptyEnvironment();
    env = develop(env, '지역', '사천');
    env = develop(env, '지형', '산');
    env = develop(env, '장소', '묘지');
    expect(env).toEqual({ 지역: '사천', 지형: '산', 장소: '묘지' }); // different types coexist

    env = develop(env, '날씨', '눈');
    env = develop(env, '날씨', '비'); // same type → replaced, never both
    expect(env['날씨']).toBe('비');
    expect(Object.values(env)).not.toContain('눈');
  });

  it('developAll applies a card\'s 전개 list', () => {
    const woogong = getDef('foolish-old-man'); // 우공이산 [전개:지형:산]
    const env = developAll(emptyEnvironment(), woogong.develops ?? []);
    expect(env['지형']).toBe('산');
  });
});

describe('play conditions (배경)', () => {
  it('미후왕 cannot be played without 돌원숭이 on field and 지형:산 in environment', () => {
    const s = newGame();
    const check = canPlayId(s, 'monkey-king', 'A');
    expect(check.ok).toBe(false);
    expect(check.missing.length).toBe(2);
  });

  it('미후왕 becomes playable once both conditions are met', () => {
    const s = newGame();
    summon(s, 'A', 'stone-monkey'); // 돌원숭이 onto the field
    s.environment = develop(s.environment, '지형', '산'); // 지형:산 developed
    const check = canPlayId(s, 'monkey-king', 'A');
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
  });

  it('a condition only matters at play time — removing it afterward does not un-play', () => {
    const s = newGame();
    summon(s, 'A', 'stone-monkey');
    s.environment = develop(s.environment, '지형', '산');
    expect(canPlayId(s, 'monkey-king', 'A').ok).toBe(true);
    const king = summon(s, 'A', 'monkey-king'); // played while conditions held
    // Now break the conditions: the king stays on the field regardless.
    s.environment = {};
    expect(s.units[king]).toBeDefined();
    expect(s.field.A).toContain(king);
  });

  it('마왕 cannot be normally summoned (소환 불가)', () => {
    const s = newGame();
    expect(canPlayId(s, 'demon-king', 'A').ok).toBe(false);
    expect(canPlayId(s, 'demon-king', 'A').reason).toBe('소환 불가');
  });
});

describe('wisdom & power conditions (배경)', () => {
  // Directly place a unit on a side for stat-condition scenarios.
  function place(s: GameState, player: 'A' | 'B', cardId: string): string {
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

  it('혁명 needs own-side total 지혜 ≥ 15', () => {
    const s = newGame();
    // demon-king(지혜10) is off the field; place units summing < 15 first.
    place(s, 'A', 'avenger'); // 지혜 2
    place(s, 'A', 'traitor'); // 지혜 5  → total 7 (< 15), and no 힘 7+ unit
    expect(canPlayId(s, 'revolution', 'A').ok).toBe(false);

    place(s, 'A', 'monkey-king'); // 지혜 5 → total 12 ... still < 15
    place(s, 'A', 'avenger'); // 지혜 2 → total 14
    place(s, 'A', 'avenger'); // 지혜 2 → total 16 ≥ 15
    expect(canPlayId(s, 'revolution', 'A').ok).toBe(true);
  });

  it('혁명 is blocked when a 힘 7+ unit is on your side', () => {
    const s = newGame();
    // Reach the wisdom threshold...
    place(s, 'A', 'traitor'); // 힘5 지혜5
    place(s, 'A', 'traitor'); // 힘5 지혜5
    place(s, 'A', 'traitor'); // 힘5 지혜5 → 지혜 15 ✓, no 힘 7+ yet
    expect(canPlayId(s, 'revolution', 'A').ok).toBe(true);

    place(s, 'A', 'monkey-king'); // 힘 6 — still < 7, fine
    expect(canPlayId(s, 'revolution', 'A').ok).toBe(true);

    place(s, 'A', 'demon-king'); // 힘 10 ≥ 7 → now blocked
    expect(canPlayId(s, 'revolution', 'A').ok).toBe(false);
  });

  it('wisdom is per-side: the opponent\'s wisdom does not count', () => {
    const s = newGame();
    place(s, 'B', 'demon-king'); // 지혜 10 on the OPPONENT side
    place(s, 'B', 'monkey-king'); // 지혜 5 → B has 15, but that is not A's
    expect(canPlayId(s, 'revolution', 'A').ok).toBe(false); // A's own wisdom is 0
  });
});

describe('loss condition', () => {
  it('a player with empty field AND empty hand loses', () => {
    const s = newGame();
    expect(checkLoss(s)).toBeNull(); // both start with a full hand
    summon(s, 'A', 'stone-monkey'); // A now has a field unit
    s.hand.A = [];
    expect(checkLoss(s)).toBeNull(); // hand empty but a unit remains on field → alive
    s.field.A = [];
    expect(checkLoss(s)).toBe('A'); // empty field AND empty hand → loses
  });
});
