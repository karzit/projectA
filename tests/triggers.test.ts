import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../src/engine/index.js';
import type { GameState } from '../src/engine/index.js';
import { atMain1, putInHand, putOnBattlefield, putOnTopOfLibrary, RICH_DECK, resolveStack, runUntil } from './helpers.js';

function game(seed = 5): GameState {
  return createGame({ seed, decks: { P0: [...RICH_DECK], P1: [...RICH_DECK] } });
}

function tapAll(state: GameState, player: 'P0' | 'P1'): GameState {
  let s = state;
  for (const id of s.zones[player].battlefield) {
    const def = s.cards[id];
    // only tap lands (things that produce mana)
    const r = reduce(s, { type: 'tapForMana', player, instanceId: id });
    if (!r.error) s = r.state;
    void def;
  }
  return s;
}

describe('card event system (triggered abilities)', () => {
  it('"whenever you draw a card, gain 1 life" fires once per draw', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'inspiring-scholar');
    putOnBattlefield(s, 'P0', 'island');
    putOnBattlefield(s, 'P0', 'island');
    putOnBattlefield(s, 'P0', 'island');
    const div = putInHand(s, 'P0', 'divination'); // draw 2
    s = runUntil(s, atMain1);
    s = tapAll(s, 'P0');

    const lifeBefore = s.players.P0.life;
    s = reduce(s, { type: 'castSpell', player: 'P0', instanceId: div }).state;
    s = resolveStack(s); // resolve Divination, then the two gain-life triggers it queued

    expect(s.players.P0.life).toBe(lifeBefore + 2); // +1 per card drawn
    expect(s.stack.length).toBe(0);
  });

  it('"whenever another creature is destroyed, draw a card" reacts to an opposing death', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'grave-warden');
    putOnBattlefield(s, 'P0', 'mountain');
    putOnBattlefield(s, 'P0', 'mountain');
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    const enemy = putOnBattlefield(s, 'P1', 'grizzly-bears'); // 2/2, dies to 3 damage
    s = runUntil(s, atMain1);
    s = tapAll(s, 'P0');

    const libBefore = s.zones.P0.library.length;
    s = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'permanent', instanceId: enemy }],
    }).state;
    s = resolveStack(s); // bolt resolves → SBA destroys grizzly → warden draws

    expect(s.cards[enemy].zone).toBe('graveyard');
    expect(s.zones.P0.library.length).toBe(libBefore - 1); // the warden drew a card
  });

  it('"whenever you are dealt damage, draw a card" reacts to player damage', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'pain-sage');
    putOnBattlefield(s, 'P0', 'mountain');
    putOnBattlefield(s, 'P0', 'mountain');
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    s = runUntil(s, atMain1);
    s = tapAll(s, 'P0');

    const libBefore = s.zones.P0.library.length;
    s = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'player', player: 'P0' }], // hit ourselves to take damage
    }).state;
    s = resolveStack(s);

    expect(s.players.P0.life).toBe(20 - 3);
    expect(s.zones.P0.library.length).toBe(libBefore - 1); // pain-sage drew from the damage
  });

  it('"when you draw THIS card, draw a card" fires for the specific drawn card (self scope)', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'island');
    putOnBattlefield(s, 'P0', 'island');
    putOnBattlefield(s, 'P0', 'island');
    const div = putInHand(s, 'P0', 'divination'); // draws the top 2 cards
    // Fix the top of the library: Owl first, then plain forests, so exactly one
    // self-trigger fires (and the extra draw isn't another Owl).
    putOnTopOfLibrary(s, 'P0', 'forest');
    putOnTopOfLibrary(s, 'P0', 'forest');
    putOnTopOfLibrary(s, 'P0', 'omen-owl');
    s = runUntil(s, atMain1);
    s = tapAll(s, 'P0');

    const libBefore = s.zones.P0.library.length;
    s = reduce(s, { type: 'castSpell', player: 'P0', instanceId: div }).state;
    s = resolveStack(s); // Divination draws 2 (incl. Owl); Owl's self-trigger draws 1 more

    // 2 from Divination + 1 from the Owl's "when drawn" trigger = 3 cards left the library.
    expect(s.zones.P0.library.length).toBe(libBefore - 3);
    expect(s.zones.P0.hand.some((id) => s.cards[id].oracleId === 'omen-owl')).toBe(true);
  });

  it('binds the event subject: "destroy → deal 2 to that creature\'s controller"', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'vindictive-ghost');
    putOnBattlefield(s, 'P0', 'mountain');
    putOnBattlefield(s, 'P0', 'mountain');
    const bolt = putInHand(s, 'P0', 'lightning-strike');
    const enemy = putOnBattlefield(s, 'P1', 'grizzly-bears');
    s = runUntil(s, atMain1);
    s = tapAll(s, 'P0');

    s = reduce(s, {
      type: 'castSpell',
      player: 'P0',
      instanceId: bolt,
      targets: [{ kind: 'permanent', instanceId: enemy }],
    }).state;
    s = resolveStack(s); // bolt kills grizzly → ghost deals 2 to grizzly's controller (P1)

    expect(s.cards[enemy].zone).toBe('graveyard');
    expect(s.players.P1.life).toBe(18); // bound damage hit P1, not P0
  });

  it('binds the drawing player: "opponent draws → deal 1 to that player"', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'toll-keeper'); // P0 controls it; P1 is the opponent
    // Advance into P1's first turn; their draw step makes them draw a card.
    s = runUntil(s, (x) => x.activePlayer === 'P1' && x.step === 'main1');
    expect(s.players.P1.life).toBe(19); // the opponent's draw dealt 1 to them
    expect(s.players.P0.life).toBe(20);
  });

  it('does not fire a controller-scoped draw trigger for the opponent drawing', () => {
    let s = game();
    putOnBattlefield(s, 'P0', 'inspiring-scholar'); // P0's "gain life when you draw"
    s = runUntil(s, (x) => x.activePlayer === 'P1' && x.step === 'main1'); // P1 drew on their turn
    expect(s.players.P0.life).toBe(20); // P1's draw must not have gained P0 life
  });
});
