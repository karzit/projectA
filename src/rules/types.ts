export type PlayerId = 'A' | 'B';

export type StatName = 'power' | 'wisdom';

// --- Environment (환경) ----------------------------------------------------
export type EnvType = string;
export type Environment = Record<EnvType, string>;

export interface EnvDevelop {
  type: EnvType;
  value: string;
}

export type Side = 'own' | 'opponent' | 'any';

// --- Play conditions (배경) ------------------------------------------------
// Checked only when the card is played; ignored thereafter.
export type PlayCondition =
  | { need: 'unit'; name: string }
  | { need: 'env'; type: EnvType; value: string }
  | { need: 'keyword'; keyword: string }
  | { need: 'wisdom'; amount: number; side?: Side }
  | { need: 'powerPresent'; amount: number; side?: Side }
  | { need: 'noPowerAtLeast'; amount: number; side?: Side };

// --- Interactive choices ---------------------------------------------------
// A card's onPlay may request targets via ctx.choices.request(...). When the
// player has not supplied enough legal choices, the Game rolls back and returns
// this request so the client can prompt; the player re-issues the same play
// action with `choices` filled. `from` is the legal selectable set; the player
// must pick between min and max of them.
export interface ChoiceRequest {
  player: PlayerId;
  cardId: string;
  prompt: string;
  from: string[];
  min: number;
  max: number;
}

// --- Game events -----------------------------------------------------------
export type GameEvent =
  | { kind: 'unitDied'; instanceId: string; cardId: string; name: string; controller: PlayerId }
  | { kind: 'envChanged'; type: EnvType; value: string }
  | { kind: 'turnStart'; active: PlayerId };

// Temporary stat buff; cleared at end of turn.
export interface TurnBuff {
  instanceId: string;
  stat: StatName;
  amount: number;
}

// A card's on-play call queued during the opening phase. Resolved as a batch
// once opening ends (A→B order, 선턴 이점). Kept as plain data so GameState
// stays serializable; Game reconstructs the call from cardId + context.
export interface DeferredPlay {
  cardId: string;
  controller: PlayerId;
  choices: string[];
  unitId?: string; // instanceId when the card is a unit
}

// --- Runtime state ---------------------------------------------------------
export interface UnitInstance {
  instanceId: string;
  cardId: string;
  owner: PlayerId;
  controller: PlayerId;
  keywords: string[];
  power: number;
  wisdom: number;
  cunning: number; // 지략 — a threshold for blocking opponent wisdom plays; NOT a summed stat
}

export interface GameState {
  environment: Environment;
  field: Record<PlayerId, string[]>;
  hand: Record<PlayerId, string[]>;
  units: Record<string, UnitInstance>;
  seed: number;
  nextId: number;
  turn: number;
  active: PlayerId;
  phase: 'opening' | 'main';
  openingPlaced: Record<PlayerId, number>;
  openingDone: Record<PlayerId, boolean>;
  openingPlays: Record<PlayerId, DeferredPlay[]>;
  rituals: Record<string, number>;
  firedForced: string[];
  turnBuffs: TurnBuff[];
  pendingEvents: GameEvent[];
  playedThisTurn: boolean;
  attackedThisTurn: string[];
  blockedThisTurn: string[]; // units that cooperated in defense this turn
  cunningUsedThisTurn: string[]; // 지략 units that spent their 지략 this turn
  lockedThisTurn: Record<PlayerId, string[]>; // cardIds blocked (locked) for that player this turn
  loser: PlayerId | null;
}
