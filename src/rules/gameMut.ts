// Low-level state mutations for the new ruleset. Every write to GameState
// happens here. Reads live in queries.ts; this module never queries.

import { emptyEnvironment } from './environment.js';
import { getDef } from './cards/CardRegistry.js';
import { unitCount } from './queries.js';
import type { CardMeta } from './cards/Card.js';
import type { GameState, PlayerId, StatName } from './types.js';
import { GRID_SIZE } from './types.js';

export interface SetupConfig {
  decks: Record<PlayerId, string[]>;
  starting?: PlayerId;
  seed?: number;
}

export function createGame(config: SetupConfig): GameState {
  return {
    environment: emptyEnvironment(),
    field: { A: Array(GRID_SIZE).fill(null), B: Array(GRID_SIZE).fill(null) },
    hand: { A: [...config.decks.A], B: [...config.decks.B] },
    units: {},
    seed: (config.seed ?? 12345) >>> 0,
    nextId: 1,
    turn: 1,
    active: config.starting ?? 'A',
    phase: 'opening',
    openingPlaced: { A: 0, B: 0 },
    openingDone: { A: false, B: false },
    openingPlays: { A: [], B: [] },
    rituals: {},
    firedForced: [],
    turnBuffs: [],
    pendingEvents: [],
    pendingPlays: [],
    actedThisTurn: [],
    blockedThisTurn: [],
    cunningUsedThisTurn: [],
    lockedThisTurn: { A: {}, B: {} },
    trapped: [],
    bondPlayedThisTurn: { A: false, B: false },
    heroKillScore: { A: 0, B: 0 },
    graveyard: { A: [], B: [] },
    pendingReaction: null,
    pendingAttack: null,
    loser: null,
    cellTraps: [],
  };
}

export function addHeroKillScore(state: GameState, player: PlayerId, amount: number): void {
  state.heroKillScore[player] = (state.heroKillScore[player] ?? 0) + amount;
}

// Update a unit's level/exp display fields (영웅담 레벨링).
export function setHeroProgress(state: GameState, instanceId: string, level: number, exp: number, expMax: number): void {
  const u = state.units[instanceId];
  if (!u) return;
  u.level = level;
  u.exp = exp;
  u.expMax = expMax;
}

export function destroyUnit(state: GameState, instanceId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  if (state.trapped.includes(instanceId)) return; // 오행산 면역
  const def = getDef(u.cardId);
  state.pendingEvents.push({ kind: 'unitDied', instanceId, cardId: u.cardId, name: def.name, controller: u.controller, power: u.power, wisdom: u.wisdom });
  // 묘지에 사망 스냅샷 보관 (owner 기준) — 교회 부활용. 강화된 스탯/레벨이 그대로 유지된다.
  state.graveyard[u.owner].push({ ...u, keywords: [...u.keywords] });
  removeUnit(state, instanceId);
}

export function exitUnit(state: GameState, instanceId: string): void {
  if (state.trapped.includes(instanceId)) return; // 오행산 면역
  removeUnit(state, instanceId);
}

function removeUnit(state: GameState, instanceId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  state.field[u.controller][u.cell] = null;
  delete state.units[instanceId];
  // Clear trap status when unit is removed.
  const ti = state.trapped.indexOf(instanceId);
  if (ti >= 0) state.trapped.splice(ti, 1);
}

export function trapUnit(state: GameState, instanceId: string): void {
  if (!state.units[instanceId]) return;
  if (!state.trapped.includes(instanceId)) state.trapped.push(instanceId);
}

export function untrapUnit(state: GameState, instanceId: string): void {
  const i = state.trapped.indexOf(instanceId);
  if (i >= 0) state.trapped.splice(i, 1);
}

// Find the first free cell (0-8). Returns null if the grid is full.
function firstFreeCell(field: (string | null)[]): number | null {
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!field[i]) return i;
  }
  return null;
}

// Places a unit on the field. If the field is full, the summoned unit is
// discarded entirely — never created, never sent to the graveyard — instead
// of failing. The returned id is still allocated but refers to nothing
// (Board.getUnit / queries on it behave as if the unit never existed).
function placeUnit(state: GameState, player: PlayerId, cardId: string, cell?: number): string {
  const instanceId = `u_${state.nextId++}`;
  const assignedCell = cell !== undefined ? cell : firstFreeCell(state.field[player]);
  if (assignedCell === null) return instanceId; // 전장이 가득 참 — 소환될 유닛을 그냥 없앤다
  const def = getDef(cardId);
  state.units[instanceId] = {
    instanceId,
    cardId,
    owner: player,
    controller: player,
    keywords: initialKeywords(def),
    power: def.power ?? 0,
    wisdom: def.wisdom ?? 0,
    cunning: def.cunning ?? 0,
    cell: assignedCell,
  };
  if (def.levels) { state.units[instanceId].level = 0; state.units[instanceId].exp = 0; state.units[instanceId].expMax = 1; }
  state.field[player][assignedCell] = instanceId;
  return instanceId;
}

export function summon(state: GameState, player: PlayerId, cardId: string, cell?: number): string {
  const idx = state.hand[player].indexOf(cardId);
  if (idx >= 0) state.hand[player].splice(idx, 1);
  return placeUnit(state, player, cardId, cell);
}

export function summonCard(state: GameState, player: PlayerId, cardId: string, cell?: number): string {
  return placeUnit(state, player, cardId, cell);
}

// 교회: 묘지에서 키워드가 일치하는 사망 유닛을 부활. 강화된 스탯/레벨/expMax는 유지하고
// 현재 exp만 0으로 리셋한다. 부활할 유닛이 없으면 null.
export function reviveFromGraveyard(state: GameState, player: PlayerId, keyword: string, cell?: number): string | null {
  const grave = state.graveyard[player];
  const idx = grave.findIndex((u) => u.keywords.includes('*') || u.keywords.includes(keyword));
  if (idx < 0) return null;
  const assignedCell = cell !== undefined ? cell : firstFreeCell(state.field[player]);
  if (assignedCell === null) return null;
  const snap = grave.splice(idx, 1)[0];
  const instanceId = `u_${state.nextId++}`;
  state.units[instanceId] = {
    ...snap,
    instanceId,
    controller: player,
    cell: assignedCell,
    keywords: [...snap.keywords],
    exp: snap.exp !== undefined ? 0 : undefined, // 현재 경험치 리셋 (최대치 expMax 유지)
  };
  state.field[player][assignedCell] = instanceId;
  return instanceId;
}

export function moveUnit(state: GameState, instanceId: string, toCell: number): void {
  const u = state.units[instanceId];
  if (!u) return;
  state.field[u.controller][u.cell] = null;
  state.field[u.controller][toCell] = instanceId;
  u.cell = toCell;
}

export function evolveTo(state: GameState, instanceId: string, newCardId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const def = getDef(newCardId);
  u.cardId = newCardId;
  u.keywords = initialKeywords(def);
  u.power = def.power ?? 0;
  u.wisdom = def.wisdom ?? 0;
  u.cunning = def.cunning ?? 0;
}

function initialKeywords(def: CardMeta): string[] {
  if (def.allKeywords) return ['*'];
  const kws = [...(def.keywords ?? [])];
  if (def.cannotAttack && !kws.includes('cannotAttack')) kws.push('cannotAttack');
  if (def.cannotMove && !kws.includes('cannotMove')) kws.push('cannotMove');
  if (def.cannotCooperate && !kws.includes('noCoop')) kws.push('noCoop');
  if (def.combatImmune && !kws.includes('combatImmune')) kws.push('combatImmune');
  return kws;
}

export function grantKeyword(state: GameState, instanceId: string, keyword: string): void {
  const u = state.units[instanceId];
  if (!u || u.keywords.includes('*') || u.keywords.includes(keyword)) return;
  u.keywords.push(keyword);
}

export function revokeKeyword(state: GameState, instanceId: string, keyword: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const i = u.keywords.indexOf(keyword);
  if (i >= 0) u.keywords.splice(i, 1);
}

export function removeFromHand(state: GameState, player: PlayerId, cardId: string): void {
  const arr = state.hand[player];
  const i = arr.indexOf(cardId);
  if (i >= 0) arr.splice(i, 1);
}

export function addToHand(state: GameState, player: PlayerId, cardId: string): void {
  state.hand[player].push(cardId);
}

export function setController(state: GameState, instanceId: string, to: PlayerId): void {
  const u = state.units[instanceId];
  if (!u || u.controller === to) return;
  if (state.trapped.includes(instanceId)) return; // 오행산 면역
  state.field[u.controller][u.cell] = null;
  u.controller = to;
  // Find a free cell on the new controller's side.
  const newCell = firstFreeCell(state.field[to]);
  if (newCell === null) throw new Error('전장이 가득 찼습니다');
  u.cell = newCell;
  state.field[to][newCell] = instanceId;
}

export function modifyStat(state: GameState, instanceId: string, stat: StatName, amount: number): void {
  const u = state.units[instanceId];
  if (!u) return;
  if (state.trapped.includes(instanceId)) return; // 오행산 면역
  u[stat] = Math.max(0, u[stat] + amount);
}

export function addTurnBuff(state: GameState, instanceId: string, stat: StatName, amount: number): void {
  if (state.trapped.includes(instanceId)) return; // 오행산 면역
  modifyStat(state, instanceId, stat, amount);
  state.turnBuffs.push({ instanceId, stat, amount });
}

export function clearTurnBuffs(state: GameState): void {
  for (const b of state.turnBuffs) modifyStat(state, b.instanceId, b.stat, -b.amount);
  state.turnBuffs = [];
}

export function grantCunning(state: GameState, instanceId: string, amount: number): void {
  const u = state.units[instanceId];
  if (!u || state.trapped.includes(instanceId)) return; // 오행산 면역
  u.cunning = Math.max(0, u.cunning + amount);
}

export function spendCunning(state: GameState, blockerId: string, player: PlayerId, cardId: string): void {
  if (!state.cunningUsedThisTurn.includes(blockerId)) state.cunningUsedThisTurn.push(blockerId);
  state.lockedThisTurn[player][cardId] = (state.lockedThisTurn[player][cardId] ?? 0) + 1;
}

export function lockCard(state: GameState, player: PlayerId, cardId: string): void {
  state.lockedThisTurn[player][cardId] = (state.lockedThisTurn[player][cardId] ?? 0) + 1;
}

export function setPendingReaction(state: GameState, pr: GameState['pendingReaction']): void {
  state.pendingReaction = pr;
}

export function setPendingAttack(state: GameState, pa: GameState['pendingAttack']): void {
  state.pendingAttack = pa;
}

export function resetCunningTurn(state: GameState): void {
  state.cunningUsedThisTurn = [];
  state.lockedThisTurn = { A: {}, B: {} };
}

export function markBondPlayed(state: GameState, player: PlayerId): void {
  state.bondPlayedThisTurn[player] = true;
}

export function resetBondTurn(state: GameState): void {
  state.bondPlayedThisTurn = { A: false, B: false };
}

export function swapStats(state: GameState, aId: string, bId: string): void {
  const a = state.units[aId];
  const b = state.units[bId];
  if (!a || !b) return;
  if (state.trapped.includes(aId) || state.trapped.includes(bId)) return; // 오행산 면역
  const { power: p, wisdom: w } = a;
  a.power = b.power; a.wisdom = b.wisdom;
  b.power = p;       b.wisdom = w;
}

export function performRitual(state: GameState, name: string): void {
  state.rituals[name] = (state.rituals[name] ?? 0) + 1;
}

export function markForcedFired(state: GameState, key: string): void {
  if (!state.firedForced.includes(key)) state.firedForced.push(key);
}

export function nextRandom(state: GameState): number {
  let s = (state.seed + 0x6d2b79f5) >>> 0;
  state.seed = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 즉시 패배 선언 (마왕 최후 등). 이미 패자가 있으면 유지.
export function declareLoss(state: GameState, player: PlayerId): void {
  if (!state.loser) state.loser = player;
}

export function checkLoss(state: GameState, turnEnder?: PlayerId): PlayerId | null {
  const aEmpty = unitCount(state, 'A') === 0;
  const bEmpty = unitCount(state, 'B') === 0;
  if (aEmpty && bEmpty) return turnEnder ?? 'A';
  if (aEmpty) return 'A';
  if (bEmpty) return 'B';
  return null;
}

// 캐슬링: 같은 컨트롤러 유닛 두 개의 셀을 교환.
export function swapPositions(state: GameState, aId: string, bId: string): void {
  const a = state.units[aId];
  const b = state.units[bId];
  if (!a || !b || a.controller !== b.controller) return;
  state.field[a.controller][a.cell] = bId;
  state.field[b.controller][b.cell] = aId;
  const tmp = a.cell;
  a.cell = b.cell;
  b.cell = tmp;
}

// 함정!: byPlayer가 otherPlayer의 cell에 덫을 설치.
export function placeCellTrap(state: GameState, byPlayer: PlayerId, cell: number): void {
  state.cellTraps.push({ byPlayer, cell });
}

// 함정!: byPlayer가 cell에 설치한 덫을 소모(제거). 있었으면 true.
export function consumeCellTrap(state: GameState, byPlayer: PlayerId, cell: number): boolean {
  const idx = state.cellTraps.findIndex((t) => t.byPlayer === byPlayer && t.cell === cell);
  if (idx < 0) return false;
  state.cellTraps.splice(idx, 1);
  return true;
}

// 여관: player 아군의 부정적(음수) 턴 버프를 즉시 되돌리고 버프 목록에서 제거.
export function clearNegativeTurnBuffsForPlayer(state: GameState, player: PlayerId): void {
  const allyIds = new Set<string>(
    Object.values(state.units).filter((u) => u?.controller === player).map((u) => u!.instanceId),
  );
  const toKeep: typeof state.turnBuffs = [];
  for (const b of state.turnBuffs) {
    if (allyIds.has(b.instanceId) && b.amount < 0) {
      modifyStat(state, b.instanceId, b.stat, -b.amount); // 복원
    } else {
      toKeep.push(b);
    }
  }
  state.turnBuffs = toKeep;
}
