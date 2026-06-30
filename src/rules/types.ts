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
  | { need: 'unitWisdom'; amount: number; side?: Side } // 단일 유닛이 해당 지혜 이상 (종말)
  | { need: 'powerPresent'; amount: number; side?: Side }
  | { need: 'noPowerAtLeast'; amount: number; side?: Side }
  | { need: 'dead'; keyword: string; side?: Side }; // 묘지에 해당 키워드 유닛이 있는가 (교회: 사망한 용사)

// --- Interactive choices ---------------------------------------------------
export interface ChoiceRequest {
  player: PlayerId;
  cardId: string;
  prompt: string;
  from: string[];
  min: number;
  max: number;
}

// --- 지략 opt-in reaction --------------------------------------------------
// 능동 플레이어가 wisdom-gated 카드를 낼 때, 상대(수비측)가 지략으로 봉쇄할지 선택하는
// 반응 창. 결정 전까지 카드 발동은 보류된다.
export interface ReactionRequest {
  player: PlayerId;            // 반응할 수 있는 플레이어 (수비측)
  cardId: string;              // 도전받는 카드
  amount: number;              // 봉쇄에 필요한 지략 임계
  eligibleBlockers: string[];  // 봉쇄 가능한 수비측 유닛
  prompt: string;
}

// 보류된 play + 반응 정보. 결정 시 _resolvePlay로 재개하거나 봉쇄한다.
export interface PendingReaction {
  player: PlayerId;
  amount: number;
  eligibleBlockers: string[];
  play: { cardId: string; controller: PlayerId; choices: string[]; cell?: number };
}

// --- Game events -----------------------------------------------------------
export type GameEvent =
  | { kind: 'unitDied'; instanceId: string; cardId: string; name: string; controller: PlayerId; power: number; wisdom: number }
  | { kind: 'envChanged'; type: EnvType; value: string }
  | { kind: 'turnStart'; active: PlayerId }
  | { kind: 'turnEnd'; active: PlayerId }
  | { kind: 'heroLevelUp'; instanceId: string; controller: PlayerId; level: number };

// Temporary stat buff; cleared at end of turn.
export interface TurnBuff {
  instanceId: string;
  stat: StatName;
  amount: number;
}

// A card's on-play call queued during the opening phase.
export interface DeferredPlay {
  cardId: string;
  controller: PlayerId;
  choices: string[];
  unitId?: string;
}

// --- Grid -----------------------------------------------------------------
// Hex grid: cells 0-4 are the front row (전열), cells 5-8 are the back row (후열).
// Each player has their own 9-cell grid; cell indices are relative to that player.
export const GRID_SIZE = 9;
export const FRONT_ROW = [0, 1, 2, 3, 4] as const;
export const BACK_ROW  = [5, 6, 7, 8]    as const;

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
  cell: number;    // position on controller's side grid (0-8)
  // 영웅담 레벨링 (용사). level/exp/expMax only tracked for units that level up.
  level?: number;  // 레벨업 횟수 (처치 기반 피보나치 돌파 수)
  exp?: number;    // 현재 누적 처치 점수 (표시용)
  expMax?: number; // 다음 레벨업까지 필요한 점수 (다음 피보나치 임계)
}

export interface GameState {
  environment: Environment;
  // 9-slot array per player. Null = empty cell. Index = cell number (0-4 front, 5-8 back).
  field: Record<PlayerId, (string | null)[]>;
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
  // Cards queued during the turn; resolved in order at turn end (개입 cards skip this queue).
  pendingPlays: DeferredPlay[];
  // Tracks units that have acted (attacked OR moved) this turn.
  actedThisTurn: string[];
  blockedThisTurn: string[]; // units that cooperated in defense this turn
  cunningUsedThisTurn: string[]; // 지략 units that spent their 지략 this turn
  lockedThisTurn: Record<PlayerId, Record<string, number>>; // cardId → locked copy count for that player this turn
  trapped: string[]; // unitIds imprisoned in 오행산 — cannot act, attack, or move
  bondPlayedThisTurn: Record<PlayerId, boolean>; // 결속 — 한 턴에 한 장 제한
  heroKillScore: Record<PlayerId, number>; // 용사 피보나치 성장용 — 처치한 적의 힘+지혜 누적
  graveyard: Record<PlayerId, UnitInstance[]>; // 사망(destroy)한 유닛 스냅샷 (owner 기준). 교회 부활용.
  pendingReaction: PendingReaction | null; // 지략 opt-in 반응 대기 중인 보류된 play
  loser: PlayerId | null;
  cellTraps: Array<{ byPlayer: PlayerId; cell: number }>; // 함정! — byPlayer가 otherPlayer의 cell에 설치
}
