// Public API of the new ruleset core.
//
// Layers (separation of responsibility):
//   types        — data model only
//   queries      — read-only "friends": the single place that reads state shape
//   environment  — environment value rules (develop / query)
//   game         — setup + state MUTATIONS (summon, destroy, setController, ...)
//   conditions   — 배경 policy (asks queries)
//   effects      — effect interpreter (asks queries, calls mutations)
//   forced       — forced-ability evaluation loop (asks queries, calls effects)
//   reducer      — turn loop / action validation (asks queries, calls the above)

export * from './types.js';
export { CARD_DEFS, getDef, hasKeyword } from './cards.js';
export { emptyEnvironment, develop, developAll, hasEnv, hasType, environmentTypes } from './environment.js';

// Read-only friends.
export {
  otherPlayer,
  findUnit,
  unitExists,
  defOf,
  allUnits,
  allUnitIds,
  fieldUnitIds,
  unitsControlledBy,
  unitCount,
  unitsOnSide,
  powerOf,
  wisdomOf,
  wisdomOnSide,
  hasPowerAtLeastOnSide,
  highestInAllStats,
  hasUnitNamed,
  unitHasKeyword,
  hasKeywordOnAnyField,
  environmentHas,
  inHand,
  handCount,
  handCardIds,
  defForCardId,
  ritualCount,
  hasForcedFired,
  isActiveTurn,
  isOpeningPhase,
  isMainPhase,
} from './queries.js';

// Mutations & setup.
export {
  createGame,
  summon,
  destroyUnit,
  setController,
  removeFromHand,
  modifyStat,
  swapStats,
  performRitual,
  markForcedFired,
  nextRandom,
  checkLoss,
  type SetupConfig,
} from './game.js';

// Policy.
export { canPlay, canPlayId, type PlayCheck } from './conditions.js';
export { resolveEffects, newContext, type EffectContext } from './effects.js';
export { settleForced } from './forced.js';
export { reduce } from './reducer.js';
export type { RulesAction, RulesResult } from './actions.js';
