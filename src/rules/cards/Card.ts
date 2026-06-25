import type { PlayCondition, EnvDevelop } from '../types.js';
import type { GameContext } from '../GameContext.js';

export type CardKind = 'unit' | 'spell';

export interface CardMeta {
  id: string;
  name: string;
  kind: CardKind;
  power?: number;
  wisdom?: number;
  cunning?: number; // 지략 — initial cunning; blocks opponent wisdom plays
  keywords?: string[];
  allKeywords?: boolean;
  cannotSummon?: boolean;
  cannotAttack?: boolean;
  evolveTarget?: string;
  conditions?: PlayCondition[];
  develops?: EnvDevelop[]; // convenience alias; resolved to board.developEnv in onPlay
}

export abstract class Card {
  abstract readonly meta: CardMeta;

  get id(): string { return this.meta.id; }
  get name(): string { return this.meta.name; }
  get kind(): CardKind { return this.meta.kind; }

  // Called when the card's on-play effect resolves (main phase play or opening end).
  onPlay(_ctx: GameContext): void {}

  // Called to register forced/automatic abilities. Invoked when the card enters
  // the hand at game start, and again when a unit enters the field (subscribe
  // is additive — Board.summon and Game._subscribeHandCards both call this).
  subscribe(_ctx: GameContext): void {}
}

export abstract class UnitCard extends Card {
  // Called when this unit is destroyed (after the unitDied event is emitted).
  onDeath(_ctx: GameContext): void {}
}
