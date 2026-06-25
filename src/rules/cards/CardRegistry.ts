import type { Card, CardMeta } from './Card.js';
import { StoneMonkey } from './defs/StoneMonkey.js';
import { FoolishOldMan } from './defs/FoolishOldMan.js';
import { MonkeyKing } from './defs/MonkeyKing.js';
import { Avenger } from './defs/Avenger.js';
import { Traitor } from './defs/Traitor.js';
import { DemonKing } from './defs/DemonKing.js';
import { Revolution } from './defs/Revolution.js';

const ALL_CARDS: Card[] = [
  StoneMonkey,
  FoolishOldMan,
  MonkeyKing,
  Avenger,
  Traitor,
  DemonKing,
  Revolution,
];

export class CardRegistry {
  private readonly map: Map<string, Card>;

  constructor(cards: Card[]) {
    this.map = new Map(cards.map((c) => [c.id, c]));
  }

  get(cardId: string): Card {
    const c = this.map.get(cardId);
    if (!c) throw new Error(`Unknown card: ${cardId}`);
    return c;
  }

  getDef(cardId: string): CardMeta {
    return this.get(cardId).meta;
  }

  all(): Card[] {
    return [...this.map.values()];
  }
}

export const CARD_REGISTRY = new CardRegistry(ALL_CARDS);

export function getCard(cardId: string): Card {
  return CARD_REGISTRY.get(cardId);
}

export function getDef(cardId: string): CardMeta {
  return CARD_REGISTRY.getDef(cardId);
}

export function findCardByName(name: string): CardMeta | undefined {
  return CARD_REGISTRY.all().find((c) => c.name === name)?.meta;
}
