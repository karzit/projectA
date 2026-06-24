// Public API of the new ruleset core.

export type {
  PlayerId, StatName, EnvType, Environment, EnvDevelop, Side,
  PlayCondition, GameEvent, TurnBuff, DeferredPlay, UnitInstance, GameState,
} from './types.js';

export type { CardKind, CardMeta } from './cards/Card.js';
export { CARD_REGISTRY, getCard, getDef } from './cards/CardRegistry.js';

export { emptyEnvironment, develop, developAll, hasEnv, hasType, environmentTypes } from './environment.js';

// Read-only state accessors.
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
  ritualCount,
  hasForcedFired,
  isActiveTurn,
  isOpeningPhase,
  isMainPhase,
  canAttack,
} from './queries.js';

// Low-level mutations (exported for direct test state manipulation).
export {
  createGame,
  summon,
  summonCard,
  destroyUnit,
  exitUnit,
  evolveTo,
  grantKeyword,
  revokeKeyword,
  setController,
  removeFromHand,
  modifyStat,
  addTurnBuff,
  clearTurnBuffs,
  swapStats,
  performRitual,
  markForcedFired,
  nextRandom,
  checkLoss,
  type SetupConfig,
} from './gameMut.js';

// Policy.
export { canPlay, canPlayId, type PlayCheck } from './conditions.js';

// Game class — primary API.
export { Game, type RulesResult } from './gameCore.js';

export type { RulesAction } from './actions.js';
