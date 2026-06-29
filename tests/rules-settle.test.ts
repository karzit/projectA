// G-3: Settle loop ordering verification.
//
// What we verify:
//  (a) Event-driven subscriptions fire when their triggering event is dequeued.
//  (b) onDeath callbacks fire as part of unitDied event processing.
//  (c) Multiple listeners on the same event all fire.
//  (d) The event queue drains completely before static subscriptions are evaluated.
//
// Convention: toMain() starts with A's turn.
//   Tests that need B to attack pass A first, then use B.
//   Tests using direct board.destroyUnit do so inside a pass action to trigger _settle.

import { describe, expect, it } from 'vitest';
import { Game, fieldUnitIds, unitCount } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function toMain(seed = 1): Game {
  const g = new Game({ decks: { A: deck(), B: deck() }, seed });
  g.apply({ type: 'finishOpening', player: 'A' });
  g.apply({ type: 'finishOpening', player: 'B' });
  return g; // A's turn
}

function place(g: Game, player: PlayerId, cardId: string, cell = 0): string {
  return g.board.summon(player, cardId, cell);
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
}

// Pass A's turn so B can act.
function passA(g: Game): void {
  act(g, { type: 'pass', player: 'A' });
}

// ─── (a) Event-driven subscription: unitDied ──────────────────────────────

describe('settle loop (a): event-driven subs fire on unitDied', () => {
  it('KingSlime gains +1/+1 when an allied slime dies', () => {
    // A attacks: A has KingSlime + stone-monkey; B has slime.
    // A's stone-monkey (power 2) attacks B's slime (power 1) → slime dies.
    // But KingSlime only reacts to *allied* slime deaths (ev.instanceId !== unitId, ev.name==='슬라임').
    // So we need an A-side slime to die. Pass A, then B attacks A's slime.
    const g = toMain();
    const ks = place(g, 'A', 'king-slime', 0);
    const slime = place(g, 'A', 'slime', 1);      // A's slime — this is what dies
    const enemy = place(g, 'B', 'stone-monkey', 0); // power 2 > slime's power 1

    const powBefore = g.state.units[ks].power;
    const wisBefore = g.state.units[ks].wisdom;

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: enemy, targetId: slime });

    expect(g.state.units[ks]).toBeDefined();
    expect(g.state.units[ks].power).toBe(powBefore + 1);
    expect(g.state.units[ks].wisdom).toBe(wisBefore + 1);
  });

  it('KingSlime does NOT gain power when a non-slime allied unit dies', () => {
    const g = toMain();
    const ks = place(g, 'A', 'king-slime', 0);
    const monkey = place(g, 'A', 'stone-monkey', 1); // not a slime
    const enemy = place(g, 'B', 'stone-monkey', 0);  // power 2 = monkey power 2 → tie, both die

    const powBefore = g.state.units[ks].power;

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: enemy, targetId: monkey });

    expect(g.state.units[ks]).toBeDefined();
    expect(g.state.units[ks].power).toBe(powBefore);
  });

  it('KingSlime gains power twice when two slimes die on separate turns', () => {
    const g = toMain();
    const ks = place(g, 'A', 'king-slime', 0);
    const s1 = place(g, 'A', 'slime', 1);
    const s2 = place(g, 'A', 'slime', 2);
    const e1 = place(g, 'B', 'stone-monkey', 0);
    const e2 = place(g, 'B', 'stone-monkey', 1);

    const powBefore = g.state.units[ks].power;

    // Turn 1: pass A, B kills slime s1
    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: e1, targetId: s1 });
    act(g, { type: 'pass', player: 'B' });

    // Turn 2: pass A, B kills slime s2
    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: e2, targetId: s2 });

    expect(g.state.units[ks].power).toBe(powBefore + 2);
  });
});

// ─── (b) onDeath callback fires via unitDied processing ───────────────────

describe('settle loop (b): onDeath fires via unitDied chain', () => {
  it('KingSlime onDeath grants cunning 2 to opponent\'s hero when KingSlime is destroyed', () => {
    const g = toMain();
    const ks = place(g, 'A', 'king-slime', 0);  // power 7
    const hero = place(g, 'B', 'hero', 0);        // power 4 — will survive
    // Use a stronger attacker to kill KingSlime
    const attacker = place(g, 'B', 'stone-monkey', 1);
    g.state.units[attacker].power = 10; // manually boost

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: attacker, targetId: ks });

    expect(g.state.units[ks]).toBeUndefined();    // KingSlime died
    expect(g.state.units[hero]).toBeDefined();     // hero survived
    expect(g.state.units[hero].cunning).toBe(2);  // onDeath granted cunning
  });

  it('KingSlime onDeath does NOT fire if KingSlime is still alive', () => {
    const g = toMain();
    const ks = place(g, 'A', 'king-slime', 0);  // power 7
    const hero = place(g, 'B', 'hero', 0);        // power 4 < 7 → hero dies, KS lives
    // hero (power 4) attacks KingSlime (power 7) → hero dies, KS survives
    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: hero, targetId: ks });

    expect(g.state.units[ks]).toBeDefined();      // KingSlime survived
    expect(g.state.units[hero]).toBeUndefined();  // hero died
    // onDeath never fired because KS didn't die — no cunning granted to anyone
    // (no hero on B's field anyway, just verify ks cunning unchanged)
    expect(g.state.units[ks].cunning).toBe(4);   // KingSlime's own cunning, unchanged
  });
});

// ─── (c) Multiple listeners on same event all fire ────────────────────────

describe('settle loop (c): multiple event-driven subs for same event all fire', () => {
  it('two KingSlimes both gain +1/+1 when a single allied slime dies', () => {
    const g = toMain();
    const ks0 = place(g, 'A', 'king-slime', 0);
    const ks2 = place(g, 'A', 'king-slime', 2);
    const slime = place(g, 'A', 'slime', 1);       // B cell-0 attacks A cells {0,1}
    const enemy = place(g, 'B', 'stone-monkey', 0);

    const pow0 = g.state.units[ks0].power;
    const pow2 = g.state.units[ks2].power;

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: enemy, targetId: slime });

    expect(g.state.units[ks0].power).toBe(pow0 + 1); // registered first (cell 0)
    expect(g.state.units[ks2].power).toBe(pow2 + 1); // registered second (cell 2)
  });

  it('KingSlime does not react to its own death via slimeFeast (filter: instanceId !== unitId)', () => {
    // Place KingSlime + one slime. Kill slime → KS gains +1.
    // Then kill KingSlime itself → slimeFeast should NOT re-fire (KS is gone).
    const g = toMain();
    const ks = place(g, 'A', 'king-slime', 0);
    const slime = place(g, 'A', 'slime', 1);
    const e1 = place(g, 'B', 'stone-monkey', 0);
    const e2 = place(g, 'B', 'stone-monkey', 1);
    // boost e2 to kill KingSlime
    g.state.units[e2].power = 10;

    const powBefore = g.state.units[ks].power;

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: e1, targetId: slime }); // slime dies → KS +1
    expect(g.state.units[ks].power).toBe(powBefore + 1);

    act(g, { type: 'attack', player: 'B', attackerId: e2, targetId: ks }); // KS dies
    expect(g.state.units[ks]).toBeUndefined(); // KS gone, no crash from self-filter
  });
});

// ─── (d) Event queue drains before static subs are evaluated ──────────────

describe('settle loop (d): event queue drains before static subs run', () => {
  it('Avenger rises after stone-monkey dies in combat (events first, then static sub)', () => {
    // Sequence: attack → both die (tie) → unitDied × 2 processed
    //           → queue empty → static sub: unitCount(A)===0 → Avenger rises
    const g = toMain();
    g.state.hand.A = ['avenger'];
    const monkey = place(g, 'A', 'stone-monkey', 0); // power 2
    const enemy = place(g, 'B', 'stone-monkey', 0);  // power 2 → tie, both die
    g.syncSubscriptions();

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: enemy, targetId: monkey });

    const aField = fieldUnitIds(g.state, 'A');
    expect(aField.length).toBe(1);
    expect(g.state.units[aField[0]].cardId).toBe('avenger');
  });

  it('KingSlime slimeFeast (event sub) fires before Avenger static sub: KS buffs before avenger check', () => {
    // A: KingSlime (field) + Slime (field) + Avenger (hand)
    // Kill slime → unitDied → KS gains +1 [event processed first]
    // → queue drains → static subs: unitCount(A)=1 (KS still alive) → Avenger does NOT rise
    const g = toMain();
    g.state.hand.A = ['avenger'];
    const ks = place(g, 'A', 'king-slime', 0);
    const slime = place(g, 'A', 'slime', 1);
    const enemy = place(g, 'B', 'stone-monkey', 0);
    g.syncSubscriptions();

    const ksPowBefore = g.state.units[ks].power;

    passA(g);
    act(g, { type: 'attack', player: 'B', attackerId: enemy, targetId: slime });

    expect(g.state.units[ks].power).toBe(ksPowBefore + 1); // event fired
    expect(g.state.hand.A).toContain('avenger');            // static sub did NOT fire
    expect(unitCount(g.state, 'A')).toBe(1);               // only KS on field
  });
});
