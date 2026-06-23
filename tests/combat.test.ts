import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../src/engine/index.js';
import type { GameState } from '../src/engine/index.js';
import { awaitingAttackers, awaitingBlockers, putOnBattlefield, RICH_DECK, runUntil } from './helpers.js';

function game(seed = 11): GameState {
  return createGame({ seed, decks: { P0: [...RICH_DECK], P1: [...RICH_DECK] } });
}

const endOfCombat = (s: GameState) => s.step === 'endCombat' || s.step === 'main2' || s.gameOver;

describe('combat', () => {
  it('an unblocked attacker damages the defending player and is tapped', () => {
    let s = game();
    const bear = putOnBattlefield(s, 'P0', 'grizzly-bears'); // 2/2
    s = runUntil(s, awaitingAttackers);

    s = reduce(s, { type: 'declareAttackers', player: 'P0', attackers: [bear] }).state;
    expect(s.cards[bear].tapped).toBe(true);

    s = runUntil(s, endOfCombat);
    expect(s.players.P1.life).toBe(18);
  });

  it('a blocked attacker and its blocker trade (both 2/2 die)', () => {
    let s = game();
    const att = putOnBattlefield(s, 'P0', 'grizzly-bears');
    const blk = putOnBattlefield(s, 'P1', 'grizzly-bears');
    s = runUntil(s, awaitingAttackers);
    s = reduce(s, { type: 'declareAttackers', player: 'P0', attackers: [att] }).state;

    s = runUntil(s, awaitingBlockers);
    const block = reduce(s, { type: 'declareBlockers', player: 'P1', blocks: { [att]: [blk] } });
    expect(block.error).toBeUndefined();
    s = block.state;

    s = runUntil(s, endOfCombat);
    expect(s.cards[att].zone).toBe('graveyard');
    expect(s.cards[blk].zone).toBe('graveyard');
    expect(s.players.P1.life).toBe(20); // damage went to the blocker, not the player
  });

  it('flying can only be blocked by flying; vigilance keeps the attacker untapped', () => {
    let s = game();
    const angel = putOnBattlefield(s, 'P0', 'serra-angel'); // 4/4 flying vigilance
    const ground = putOnBattlefield(s, 'P1', 'grizzly-bears');
    s = runUntil(s, awaitingAttackers);
    s = reduce(s, { type: 'declareAttackers', player: 'P0', attackers: [angel] }).state;
    expect(s.cards[angel].tapped).toBe(false); // vigilance

    s = runUntil(s, awaitingBlockers);
    const illegal = reduce(s, { type: 'declareBlockers', player: 'P1', blocks: { [angel]: [ground] } });
    expect(illegal.error).toBeTruthy(); // ground creature cannot block a flyer

    s = runUntil(s, endOfCombat); // no blocks -> 4 to the face
    expect(s.players.P1.life).toBe(16);
  });

  it('summoning sickness blocks attacking, but haste ignores it', () => {
    let s = game();
    const sick = putOnBattlefield(s, 'P0', 'grizzly-bears');
    s.cards[sick].summoningSick = true;
    const haste = putOnBattlefield(s, 'P0', 'goblin-raider'); // has haste
    s.cards[haste].summoningSick = true;
    s = runUntil(s, awaitingAttackers);

    const bad = reduce(s, { type: 'declareAttackers', player: 'P0', attackers: [sick] });
    expect(bad.error).toBeTruthy();

    const ok = reduce(s, { type: 'declareAttackers', player: 'P0', attackers: [haste] });
    expect(ok.error).toBeUndefined();
  });
});
