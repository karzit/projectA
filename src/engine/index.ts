// Public API of the headless rules engine. Renderer, input layer, server, and
// AI all consume the engine exclusively through these exports.

export * from './types.js';
export type { Action, ReduceResult } from './actions.js';
export { reduce } from './reducer.js';
export { createGame, applyActions, passUntil } from './game.js';
export type { GameConfig } from './game.js';
export { CARD_DEFS, getDef, isPermanentType } from './cards.js';
export { canPay, pay, parseCost, emptyPool } from './mana.js';
export { listZone, zoneHolder } from './zones.js';
export { otherPlayer } from './phases.js';
