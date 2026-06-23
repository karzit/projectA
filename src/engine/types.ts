// Core type definitions for the rules engine.
// Everything here is plain data: GameState is fully serializable (JSON) so it
// can be replayed, sent over the wire, or snapshotted for the renderer.

export type PlayerId = 'P0' | 'P1';

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack';

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export type CardType =
  | 'land'
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment';

// Standard MTG turn structure. `untap` and `cleanup` are turn-based-only steps
// (no player normally receives priority during them).
export type Step =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'beginCombat'
  | 'declareAttackers'
  | 'declareBlockers'
  | 'combatDamage'
  | 'endCombat'
  | 'main2'
  | 'end'
  | 'cleanup';

export interface ManaCost {
  generic: number;
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
}

export type ManaPool = Record<ManaColor, number>;

// A required target's constraint, declared on the card.
export type TargetSpec = 'anyTarget' | 'creature' | 'player' | 'opponent';

// A resolved target chosen by the caster.
export type TargetRef =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'permanent'; instanceId: string };

// A single primitive an effect performs. The interpreter (effects.ts) executes
// these in order; targets are consumed from the stack object's `targets` list.
export interface EffectSpec {
  op: 'dealDamage' | 'drawCards' | 'gainLife' | 'loseLife' | 'destroy';
  amount?: number;
  toController?: boolean; // for drawCards/gainLife: affect the controller
}

// A triggered ability: "When/Whenever <condition>, <effect>." The condition is
// matched against the engine's GameEvent stream; when it fires, the ability is
// put on the stack (controlled by the card's controller) and resolves like a
// spell's effect. Scope words decide self/other/owner relationships.
export type TriggerCondition =
  // a card is drawn — by this card itself, its controller, an opponent, or anyone
  | { kind: 'cardDrawn'; by: 'self' | 'controller' | 'opponent' | 'any' }
  // a permanent enters the battlefield
  | { kind: 'enteredBattlefield'; who: 'self' | 'other' | 'any'; cardType?: CardType }
  // a permanent leaves the battlefield (any reason)
  | { kind: 'leftBattlefield'; who: 'self' | 'other' | 'any'; cardType?: CardType }
  // a permanent is destroyed (a subset of leaving, via lethal damage / destroy)
  | { kind: 'destroyed'; who: 'self' | 'other' | 'any'; cardType?: CardType }
  // a player is dealt damage
  | { kind: 'playerDamaged'; who: 'controller' | 'opponent' | 'any' };

// Captures a subject from the triggering event and feeds it to the effect as a
// target (so an effect can reference "that player" / "that creature").
//   eventPlayer         — the player in the event (damaged player, drawer)
//   eventCard           — the card subject (destroyed / entered / left)
//   eventCardController — the controller of that card subject (as a player)
export type TriggerBind = 'eventPlayer' | 'eventCard' | 'eventCardController';

export interface TriggeredAbility {
  // Zones from which this ability "watches". Default ['battlefield']. Use
  // ['hand'] for "when this card is drawn", ['graveyard'] for "when this dies".
  zones?: ZoneName[];
  on: TriggerCondition;
  // When set, the bound subject becomes the effect's target (in order). Effects
  // with no target ops ignore it.
  bind?: TriggerBind;
  effect: EffectSpec[]; // resolved with the controller as the subject
}

// Static, immutable card text — the "oracle" definition. Many CardInstances can
// share one CardDef.
export interface CardDef {
  oracleId: string;
  name: string;
  types: CardType[];
  cost: ManaCost | null; // null = cannot be cast for mana (basic lands)
  power?: number;
  toughness?: number;
  keywords?: string[]; // 'flying', 'haste', 'vigilance', ...
  produces?: ManaColor[]; // mana a land taps for
  targets?: TargetSpec[]; // required targets, in order
  effect?: EffectSpec[]; // resolution effect for spells/abilities
  triggers?: TriggeredAbility[]; // reactive abilities (see TriggeredAbility)
}

// A concrete card in play. State that differs between two copies of the same
// card lives here, never on the CardDef.
export interface CardInstance {
  instanceId: string;
  oracleId: string;
  owner: PlayerId; // never changes
  controller: PlayerId; // can change (control effects)
  zone: ZoneName;
  tapped: boolean;
  damage: number;
  counters: Record<string, number>;
  summoningSick: boolean;
  attackedFlag?: boolean; // bookkeeping during combat
}

export interface StackObject {
  id: string;
  kind: 'spell' | 'ability';
  controller: PlayerId;
  oracleId: string;
  cardInstanceId?: string; // the physical card travelling via the stack
  effect: EffectSpec[];
  targets: TargetRef[];
}

export interface PlayerZones {
  library: string[]; // index 0 = top of library
  hand: string[];
  graveyard: string[];
  exile: string[];
  battlefield: string[]; // permanents this player controls
}

export interface PlayerState {
  id: PlayerId;
  life: number;
  manaPool: ManaPool;
  landPlaysRemaining: number;
  hasLost: boolean;
  drewFromEmpty: boolean; // set when a draw from an empty library is attempted
}

export interface CombatState {
  // attacker instanceId -> defending player
  attackers: Record<string, PlayerId>;
  // attacker instanceId -> ordered blocker instanceIds
  blocks: Record<string, string[]>;
}

export interface AwaitingAction {
  player: PlayerId;
  kind: 'declareAttackers' | 'declareBlockers';
}

export interface GameState {
  seed: number; // PRNG state; advanced on every random operation
  nextId: number; // monotonic id source (deterministic)
  turn: number;
  activePlayer: PlayerId;
  step: Step;
  priority: PlayerId | null; // who may act now (null while awaiting a declaration)
  consecutivePasses: number; // resolves/advances when this reaches player count
  awaiting: AwaitingAction | null; // a required non-priority decision
  stack: StackObject[]; // LIFO; last element is the top
  cards: Record<string, CardInstance>;
  zones: Record<PlayerId, PlayerZones>;
  players: Record<PlayerId, PlayerState>;
  combat: CombatState | null;
  winner: PlayerId | null;
  gameOver: boolean;
}

// Emitted by the reducer for the renderer / animation / replay log. Never read
// back by the engine — purely an output channel.
export type GameEvent =
  | { type: 'zoneChange'; instanceId: string; from: ZoneName; to: ZoneName }
  | { type: 'damage'; target: TargetRef; amount: number }
  | { type: 'life'; player: PlayerId; delta: number; total: number }
  | { type: 'draw'; player: PlayerId; instanceId: string | null }
  | { type: 'tap'; instanceId: string; tapped: boolean }
  | { type: 'cast'; stackId: string; oracleId: string; controller: PlayerId }
  | { type: 'trigger'; stackId: string; oracleId: string; controller: PlayerId }
  | { type: 'resolve'; stackId: string }
  | { type: 'stepChange'; step: Step; turn: number; activePlayer: PlayerId }
  | { type: 'priority'; player: PlayerId | null }
  | { type: 'awaiting'; player: PlayerId; kind: AwaitingAction['kind'] }
  | { type: 'destroyed'; instanceId: string }
  | { type: 'gameOver'; winner: PlayerId | null };
