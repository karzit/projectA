// Data model for the new ruleset (a fresh design, separate from src/engine).
//
// Summary of the rules this encodes:
//  - No resources. Deck = 15 cards, all in hand at the start; field starts empty.
//  - You LOSE when your field AND hand are both empty (attrition).
//  - 배경 (background): play CONDITIONS, checked only at the moment you play a
//    card; once it is in play the condition no longer needs to hold.
//  - 환경 (environment): an open-ended map of TYPE -> value. A card's effect can
//    "develop" (전개) an environment. The same TYPE cannot stack (a new value of
//    that type replaces it); different types coexist freely. Types are NOT a
//    fixed enum — any string type is allowed.
//  - Forced abilities: effects that fire automatically when a condition holds.

export type PlayerId = 'A' | 'B';

// --- Environment (환경) ----------------------------------------------------
// One value per type; type is open-ended (지형, 지역, 장소, 날씨, ...).
export type EnvType = string;
export type Environment = Record<EnvType, string>;

// What a card's effect adds to the environment (전개:지형:산).
export interface EnvDevelop {
  type: EnvType;
  value: string;
}

// Which side a stat condition looks at, relative to the player playing the card.
export type Side = 'own' | 'opponent' | 'any';

// --- Play conditions (배경) ------------------------------------------------
// Checked only when the card is played; ignored thereafter.
//
// 지혜 (wisdom) is NOT a consumed resource — it is a THRESHOLD condition: a card
// can require a minimum total wisdom on a side (the sum of that side's units'
// wisdom). 힘 (power) can likewise gate a card by presence/absence of a strong
// unit. Example — 혁명![배경:지혜:15, 자신 진영에 힘 7이상 유닛이 없을 경우 …].
export type PlayCondition =
  | { need: 'unit'; name: string } // a unit by this name must be on a field (배경:돌원숭이)
  | { need: 'env'; type: EnvType; value: string } // an environment entry must exist (지형:산)
  | { need: 'keyword'; keyword: string } // a unit with this keyword must be on a field
  | { need: 'wisdom'; amount: number; side?: Side } // total wisdom on the side ≥ amount (지혜:15)
  | { need: 'powerPresent'; amount: number; side?: Side } // some unit with power ≥ amount exists
  | { need: 'noPowerAtLeast'; amount: number; side?: Side }; // no unit with power ≥ amount (힘 7이상 없을 경우)

// --- Effects (the shared vocabulary for on-play AND forced abilities) -------
// A selector chooses which units an effect operates on, relative to the source.
export type Selector =
  | { kind: 'self' } // the source unit
  | { kind: 'ownField' } // all units on the source controller's side
  | { kind: 'oppField' }
  | { kind: 'anyField' }
  | { kind: 'chosen'; count: number } // player-chosen units (supplied with the action)
  | { kind: 'random'; from: 'ownField' | 'oppField' | 'anyField'; count: number };

// A count that may depend on the current board.
export type CountExpr = number | 'enemyUnitCount' | 'ownUnitCount';

// The effect primitives. New cards add data, not engine branches; new VERBS are
// the only reason to extend the interpreter.
export type Effect =
  | { do: 'develop'; type: EnvType; value: string } // 전개
  | { do: 'destroy'; target: Selector } // 처치
  | { do: 'swapStats'; a: Selector; b: Selector } // 능력치 뒤바꾸기 (혁명)
  | { do: 'modifyStat'; target: Selector; stat: 'power' | 'wisdom'; amount: number }
  | { do: 'summonSelf' } // 복수자: bring this card from hand to the field
  | { do: 'defect'; target: Selector } // 배신자: move unit(s) to the opponent's control
  | { do: 'descend' } // 마왕강림: special-summon ignoring cannotSummon
  | { do: 'ritual'; name: string } // 의식 수행 — advance a named ritual counter (마왕 부활 의식)
  | { do: 'repeat'; times: CountExpr; effects: Effect[] };

// --- Forced / automatic abilities ------------------------------------------
// Fire when their trigger holds. The automatic evaluation engine (WHEN to check)
// is a separate step; the data + shared Effect vocabulary are ready here.
export type ForcedTrigger =
  | { on: 'ownFieldEmpty' } // 복수자
  | { on: 'highestStat'; stats: Array<'power' | 'wisdom'>; side: 'own' } // 배신자
  | { on: 'ritual'; name: string; count: number }; // 마왕: 부활 의식 N회

export interface ForcedAbility {
  id: string;
  trigger: ForcedTrigger;
  effect: Effect[];
  once?: boolean; // fire at most once per game
}

// --- Cards -----------------------------------------------------------------
export type CardKind = 'unit' | 'spell';

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  power?: number; // 힘 (units)
  wisdom?: number; // 지혜 (units)
  keywords?: string[];
  allKeywords?: boolean; // 마왕: 모든 키워드를 가짐
  cannotSummon?: boolean; // 마왕: 소환 불가 (only special-summonable)
  conditions?: PlayCondition[]; // 배경
  develops?: EnvDevelop[]; // 전개 (convenience; equivalent to a 'develop' effect)
  effects?: Effect[]; // on-play effects (spell resolution / unit enters)
  forced?: ForcedAbility[];
}

// --- Runtime state ---------------------------------------------------------
export interface UnitInstance {
  instanceId: string;
  cardId: string;
  owner: PlayerId; // never changes
  controller: PlayerId; // can change (배신자 defects)
  keywords: string[]; // effective keywords (may include 'all' marker)
  power: number; // 힘 — mutable (swapped/buffed by effects)
  wisdom: number; // 지혜 — mutable
}

export interface GameState {
  environment: Environment; // shared/global (see assumptions in README)
  field: Record<PlayerId, string[]>; // controller -> unit instanceIds (진영)
  hand: Record<PlayerId, string[]>; // owner -> cardIds (start: all 15)
  units: Record<string, UnitInstance>;
  seed: number; // PRNG state for deterministic random effects (배신자 등)
  nextId: number;
  turn: number;
  active: PlayerId;
  phase: 'opening' | 'main'; // opening = the initial up-to-3 plays
  openingPlaced: Record<PlayerId, number>; // cards placed during opening (max 3)
  openingDone: Record<PlayerId, boolean>; // finished placing in the opening
  rituals: Record<string, number>; // named ritual counters (마왕 부활 의식 등)
  firedForced: string[]; // keys of 'once' forced abilities already fired this game
  loser: PlayerId | null;
}
