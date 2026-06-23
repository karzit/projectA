// Combat damage assignment. A deliberately minimal subset of MTG combat: no
// first strike, no trample, no deathtouch. Damage is gathered conceptually as
// "simultaneous" — everything is applied here, and lethal/death is resolved by
// SBA immediately afterward (called by the reducer), so no creature dies
// mid-assignment.

import { getDef } from './cards.js';
import type { CombatState, GameEvent, GameState } from './types.js';

export function emptyCombat(): CombatState {
  return { attackers: {}, blocks: {} };
}

export function dealCombatDamage(state: GameState, events: GameEvent[]): void {
  const combat = state.combat;
  if (!combat) return;

  for (const attId of Object.keys(combat.attackers)) {
    const att = state.cards[attId];
    if (!att || att.zone !== 'battlefield') continue;
    const adef = getDef(att.oracleId);
    const power = adef.power ?? 0;

    const blockers = (combat.blocks[attId] ?? []).filter((b) => state.cards[b]?.zone === 'battlefield');
    const wasBlocked = (combat.blocks[attId] ?? []).length > 0;

    if (!wasBlocked) {
      // Unblocked: damage the defending player.
      const defender = combat.attackers[attId];
      const p = state.players[defender];
      p.life -= power;
      events.push({ type: 'damage', target: { kind: 'player', player: defender }, amount: power });
      events.push({ type: 'life', player: defender, delta: -power, total: p.life });
      continue;
    }

    // Blocked: distribute the attacker's power across its blockers (lethal to
    // each in order; no trample, so overflow is lost), and each blocker deals
    // its full power back to the attacker.
    let remaining = power;
    for (const bId of blockers) {
      const b = state.cards[bId];
      const bdef = getDef(b.oracleId);
      const need = Math.max(0, (bdef.toughness ?? 0) - b.damage);
      const assign = Math.min(remaining, need);
      if (assign > 0) {
        b.damage += assign;
        remaining -= assign;
        events.push({ type: 'damage', target: { kind: 'permanent', instanceId: bId }, amount: assign });
      }
      const bpow = bdef.power ?? 0;
      if (bpow > 0) {
        att.damage += bpow;
        events.push({ type: 'damage', target: { kind: 'permanent', instanceId: attId }, amount: bpow });
      }
    }
  }
}
