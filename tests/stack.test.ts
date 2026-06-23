import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../src/engine/index.js';
import type { GameState } from '../src/engine/index.js';
import { atMain1, putInHand, putOnBattlefield, RICH_DECK, runUntil } from './helpers.js';

function game(seed = 3): GameState {
  return createGame({ seed, decks: { P0: [...RICH_DECK], P1: [...RICH_DECK] } });
}

function pass(s: GameState, p: 'P0' | 'P1'): GameState {
  const r = reduce(s, { type: 'passPriority', player: p });
  if (r.error) throw new Error(r.error);
  return r.state;
}

describe('casting & resolution', () => {
  it('resolves an instant: Lightning Strike deals 3 to a player', () => {
    let s = game();
    const m1 = putOnBattlefield(s, 'P0', 'mountain');
    const m2 = putOnBattlefield(s, 'P0', 'mountain');
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    s = runUntil(s, atMain1);

    s = reduce(s, { type: 'tapForMana', player: 'P0', instanceId: m1 }).state;
    s = reduce(s, { type: 'tapForMana', player: 'P0', instanceId: m2 }).state;

    const cast = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'player', player: 'P1' }],
    });
    expect(cast.error).toBeUndefined();
    s = cast.state;
    expect(s.stack.length).toBe(1);
    expect(s.priority).toBe('P0'); // caster keeps priority

    s = pass(s, 'P0');
    s = pass(s, 'P1'); // both pass -> resolve
    expect(s.stack.length).toBe(0);
    expect(s.players.P1.life).toBe(17);
    expect(s.cards[bolt].zone).toBe('graveyard');
  });

  it('destroys a creature via lethal damage (state-based action)', () => {
    let s = game();
    const m1 = putOnBattlefield(s, 'P0', 'mountain');
    const m2 = putOnBattlefield(s, 'P0', 'mountain');
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    const bear = putOnBattlefield(s, 'P1', 'grizzly-bears'); // 2/2
    s = runUntil(s, atMain1);

    s = reduce(s, { type: 'tapForMana', player: 'P0', instanceId: m1 }).state;
    s = reduce(s, { type: 'tapForMana', player: 'P0', instanceId: m2 }).state;
    s = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'permanent', instanceId: bear }],
    }).state;

    s = pass(s, 'P0');
    s = pass(s, 'P1'); // resolve; 3 damage to a 2/2 -> SBA destroys it
    expect(s.cards[bear].zone).toBe('graveyard');
  });

  it('rejects an illegal target (a sorcery-speed land is not a legal creature target)', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'mountain');
    putOnBattlefield(s, 'P0', 'mountain');
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    const ownLand = s.zones.P0.battlefield[0];
    s = runUntil(s, atMain1);
    for (const id of s.zones.P0.battlefield) s = reduce(s, { type: 'tapForMana', player: 'P0', instanceId: id }).state;

    const res = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'permanent', instanceId: ownLand }], // a land, not a creature/player
    });
    expect(res.error).toBeTruthy();
    expect(res.state.stack.length).toBe(0);
  });

  it('resolves the stack last-in-first-out', () => {
    let s = game();
    const lands = [
      putOnBattlefield(s, 'P0', 'mountain'),
      putOnBattlefield(s, 'P0', 'mountain'),
      putOnBattlefield(s, 'P0', 'plains'),
      putOnBattlefield(s, 'P0', 'plains'),
    ];
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    const salve = putInHand(s, 'P0', 'healing-salve');
    s = runUntil(s, atMain1);
    for (const id of lands) s = reduce(s, { type: 'tapForMana', player: 'P0', instanceId: id }).state;

    // Cast the burn at the opponent, then the lifegain on top in response.
    s = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'player', player: 'P1' }],
    }).state;
    s = reduce(s, { type: 'castSpell', player: 'P0', instanceId: salve }).state;
    expect(s.stack.length).toBe(2);

    // First all-pass resolves the TOP object (the lifegain) only.
    s = pass(s, 'P0');
    s = pass(s, 'P1');
    expect(s.players.P0.life).toBe(23); // salve resolved
    expect(s.players.P1.life).toBe(20); // bolt still on the stack
    expect(s.stack.length).toBe(1);

    // Second all-pass resolves the burn.
    s = pass(s, 'P0');
    s = pass(s, 'P1');
    expect(s.players.P1.life).toBe(17);
    expect(s.stack.length).toBe(0);
  });
});
