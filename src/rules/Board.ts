// Battlefield mediator. The only place that writes to GameState (via gameMut.ts
// primitives) and the only place that reads via queries.ts. Cards call Board
// methods from their onPlay / subscribe callbacks — never touching state directly.

import * as G from './gameMut.js';
import * as Q from './queries.js';
import { develop } from './environment.js';
import type { EventManager } from './EventManager.js';
import type { CardRegistry } from './cards/CardRegistry.js';
import type { GameState, PlayerId, StatName } from './types.js';
import { makeContext } from './GameContext.js';

// A thin handle over a unit instanceId — gives units method-call semantics.
export class UnitHandle {
  constructor(
    readonly instanceId: string,
    private readonly board: Board,
  ) {}

  get power(): number { return Q.powerOf(this.board.state, this.instanceId); }
  get wisdom(): number { return Q.wisdomOf(this.board.state, this.instanceId); }
  get cardId(): string { return this.board.state.units[this.instanceId]?.cardId ?? ''; }
  get controller(): PlayerId { return this.board.state.units[this.instanceId]?.controller ?? 'A'; }

  buffStat(stat: StatName, amount: number): void { this.board.modifyStat(this.instanceId, stat, amount); }
  addTurnBuff(stat: StatName, amount: number): void { this.board.addTurnBuff(this.instanceId, stat, amount); }
  destroy(): void { this.board.destroyUnit(this.instanceId); }
  exit(): void { this.board.exitUnit(this.instanceId); }
  defectTo(to: PlayerId): void { this.board.setController(this.instanceId, to); }
  grantKeyword(kw: string): void { G.grantKeyword(this.board.state, this.instanceId, kw); }
  revokeKeyword(kw: string): void { G.revokeKeyword(this.board.state, this.instanceId, kw); }
  evolve(): void { this.board.evolveUnit(this.instanceId); }
}

export class Board {
  constructor(
    public readonly state: GameState,
    private readonly events: EventManager,
    private readonly registry: CardRegistry,
  ) {}

  // --- reads -----------------------------------------------------------------

  getUnit(id: string): UnitHandle | undefined {
    return Q.unitExists(this.state, id) ? new UnitHandle(id, this) : undefined;
  }

  unitsOn(player: PlayerId): UnitHandle[] {
    return Q.fieldUnitIds(this.state, player).map((id) => new UnitHandle(id, this));
  }

  unitCount(player: PlayerId): number { return Q.unitCount(this.state, player); }
  isInHand(player: PlayerId, cardId: string): boolean { return Q.inHand(this.state, player, cardId); }
  otherPlayer(p: PlayerId): PlayerId { return Q.otherPlayer(p); }
  ritualCount(name: string): number { return Q.ritualCount(this.state, name); }
  highestInAllStats(player: PlayerId, stats: StatName[]) {
    return Q.highestInAllStats(this.state, player, stats);
  }

  pickRandom(scope: 'ownField' | 'oppField', player: PlayerId, n: number): string[] {
    const pool = scope === 'ownField'
      ? Q.fieldUnitIds(this.state, player)
      : Q.fieldUnitIds(this.state, Q.otherPlayer(player));
    return _pickRandom(this.state, pool, n);
  }

  // --- writes ----------------------------------------------------------------

  // Place a card directly from hand to field. Registers the card's subscriptions.
  summon(player: PlayerId, cardId: string): string {
    const instanceId = G.summon(this.state, player, cardId);
    this._subscribeUnit(instanceId, player, cardId);
    return instanceId;
  }

  // Spawn a card to a field without requiring it in hand (summonTo effect).
  summonCard(player: PlayerId, cardId: string): string {
    const instanceId = G.summonCard(this.state, player, cardId);
    this._subscribeUnit(instanceId, player, cardId);
    return instanceId;
  }

  destroyUnit(instanceId: string): void {
    const u = this.state.units[instanceId];
    if (!u) return;
    // Fire selfDied event subscriptions before unsubscribing (so onDeath can see the unit).
    G.destroyUnit(this.state, instanceId);
    this.events.unsubscribeUnit(instanceId);
  }

  exitUnit(instanceId: string): void {
    G.exitUnit(this.state, instanceId);
    this.events.unsubscribeUnit(instanceId);
  }

  setController(instanceId: string, to: PlayerId): void {
    G.setController(this.state, instanceId, to);
  }

  modifyStat(instanceId: string, stat: StatName, amount: number): void {
    G.modifyStat(this.state, instanceId, stat, amount);
  }

  addTurnBuff(instanceId: string, stat: StatName, amount: number): void {
    G.addTurnBuff(this.state, instanceId, stat, amount);
  }

  swapStats(a: string, b: string): void { G.swapStats(this.state, a, b); }

  developEnv(type: string, value: string): void {
    const prev = this.state.environment[type];
    this.state.environment = develop(this.state.environment, type, value);
    if (this.state.environment[type] !== prev) {
      this.state.pendingEvents.push({ kind: 'envChanged', type, value });
    }
  }

  performRitual(name: string): void { G.performRitual(this.state, name); }

  evolveUnit(instanceId: string): void {
    const u = this.state.units[instanceId];
    if (!u) return;
    const card = this.registry.get(u.cardId);
    if (card.meta.evolveTarget) G.evolveTo(this.state, instanceId, card.meta.evolveTarget);
  }

  private _subscribeUnit(instanceId: string, controller: PlayerId, cardId: string): void {
    const card = this.registry.get(cardId);
    const ctx = makeContext(instanceId, controller, cardId, this, this.events);
    card.subscribe(ctx);
  }
}

function _pickRandom(state: GameState, pool: string[], count: number): string[] {
  const arr = [...pool];
  const out: string[] = [];
  for (let k = 0; k < count && arr.length > 0; k++) {
    const idx = Math.floor(G.nextRandom(state) * arr.length);
    out.push(arr.splice(idx, 1)[0]);
  }
  return out;
}
