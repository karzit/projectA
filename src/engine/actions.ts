// The Action (Intent) union. Every player input is one of these — serializable,
// validated by the reducer, and the only way game state ever changes. This is
// exactly what a client sends to an authoritative server.

import type { PlayerId, TargetRef } from './types.js';

export type Action =
  | { type: 'passPriority'; player: PlayerId }
  | { type: 'playLand'; player: PlayerId; instanceId: string }
  | { type: 'tapForMana'; player: PlayerId; instanceId: string }
  | { type: 'castSpell'; player: PlayerId; instanceId: string; targets?: TargetRef[] }
  | { type: 'declareAttackers'; player: PlayerId; attackers: string[] }
  | { type: 'declareBlockers'; player: PlayerId; blocks: Record<string, string[]> };

export interface ReduceResult {
  state: import('./types.js').GameState;
  events: import('./types.js').GameEvent[];
  error?: string; // set (with unchanged state) when the action was illegal
}
