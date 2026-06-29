// Public API of the new ruleset core.

export type {
  PlayerId, StatName, EnvType, Environment, EnvDevelop, Side,
  PlayCondition, GameEvent, TurnBuff, DeferredPlay, UnitInstance, GameState,
  ChoiceRequest,
} from './types.js';
export { GRID_SIZE, FRONT_ROW, BACK_ROW } from './types.js';

export { ChoiceRequired, type ChoiceSpec } from './GameContext.js';

export type { CardKind, CardMeta } from './cards/Card.js';
export { CARD_REGISTRY, getCard, getDef, findCardByName } from './cards/CardRegistry.js';

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
  canBlock,
  canMove,
  hexAdjacent,
  attackableTargets,
  unitAtCell,
  isTrapped,
  isHandSlotLocked,
  HEX_ADJACENT,
  ATTACK_TARGETS,
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
export { canPlay, canPlayId, conditionMet, type PlayCheck } from './conditions.js';

// Game class — primary API.
export { Game, type RulesResult } from './gameCore.js';

export type { RulesAction } from './actions.js';
