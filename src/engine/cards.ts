// Sample card definitions + a registry. In a real build these would be loaded
// from JSON data files; effects are data, not hardcoded branches, so new cards
// are added without touching the engine.

import { parseCost } from './mana.js';
import type { CardDef } from './types.js';

function def(d: Omit<CardDef, 'cost'> & { cost: string | null }): CardDef {
  return { ...d, cost: d.cost === null ? null : parseCost(d.cost) };
}

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(
  [
    // --- Basic lands (tap for one mana of their color) ---
    def({ oracleId: 'plains', name: 'Plains', types: ['land'], cost: null, produces: ['W'] }),
    def({ oracleId: 'island', name: 'Island', types: ['land'], cost: null, produces: ['U'] }),
    def({ oracleId: 'swamp', name: 'Swamp', types: ['land'], cost: null, produces: ['B'] }),
    def({ oracleId: 'mountain', name: 'Mountain', types: ['land'], cost: null, produces: ['R'] }),
    def({ oracleId: 'forest', name: 'Forest', types: ['land'], cost: null, produces: ['G'] }),

    // --- Creatures ---
    def({
      oracleId: 'grizzly-bears',
      name: 'Grizzly Bears',
      types: ['creature'],
      cost: '1G',
      power: 2,
      toughness: 2,
    }),
    def({
      oracleId: 'hill-giant',
      name: 'Hill Giant',
      types: ['creature'],
      cost: '3R',
      power: 3,
      toughness: 3,
    }),
    def({
      oracleId: 'serra-angel',
      name: 'Serra Angel',
      types: ['creature'],
      cost: '3WW',
      power: 4,
      toughness: 4,
      keywords: ['flying', 'vigilance'],
    }),
    def({
      oracleId: 'goblin-raider',
      name: 'Goblin Raider',
      types: ['creature'],
      cost: 'R',
      power: 2,
      toughness: 1,
      keywords: ['haste'],
    }),

    // --- Instants / sorceries (data-driven effects) ---
    def({
      oracleId: 'lightning-strike',
      name: 'Lightning Strike',
      types: ['instant'],
      cost: '1R',
      targets: ['anyTarget'],
      effect: [{ op: 'dealDamage', amount: 3 }],
    }),
    def({
      oracleId: 'divination',
      name: 'Divination',
      types: ['sorcery'],
      cost: '2U',
      effect: [{ op: 'drawCards', amount: 2, toController: true }],
    }),
    def({
      oracleId: 'healing-salve',
      name: 'Healing Salve',
      types: ['instant'],
      cost: 'W',
      effect: [{ op: 'gainLife', amount: 3, toController: true }],
    }),

    // --- Cards with triggered abilities (the card event system) ---
    def({
      oracleId: 'inspiring-scholar',
      name: 'Inspiring Scholar',
      types: ['creature'],
      cost: '1W',
      power: 1,
      toughness: 3,
      // "Whenever you draw a card, gain 1 life."
      triggers: [{ on: { kind: 'cardDrawn', by: 'controller' }, effect: [{ op: 'gainLife', amount: 1, toController: true }] }],
    }),
    def({
      oracleId: 'grave-warden',
      name: 'Grave Warden',
      types: ['creature'],
      cost: '2B',
      power: 2,
      toughness: 2,
      // "Whenever another creature is destroyed, draw a card."
      triggers: [
        { on: { kind: 'destroyed', who: 'other', cardType: 'creature' }, effect: [{ op: 'drawCards', amount: 1, toController: true }] },
      ],
    }),
    def({
      oracleId: 'pain-sage',
      name: 'Pain Sage',
      types: ['creature'],
      cost: '1B',
      power: 2,
      toughness: 2,
      // "Whenever you are dealt damage, draw a card."
      triggers: [{ on: { kind: 'playerDamaged', who: 'controller' }, effect: [{ op: 'drawCards', amount: 1, toController: true }] }],
    }),
    def({
      oracleId: 'omen-owl',
      name: 'Omen Owl',
      types: ['creature'],
      cost: '1U',
      power: 1,
      toughness: 1,
      keywords: ['flying'],
      // "When you draw this card, draw a card." Watches from the hand.
      triggers: [{ zones: ['hand'], on: { kind: 'cardDrawn', by: 'self' }, effect: [{ op: 'drawCards', amount: 1, toController: true }] }],
    }),

    // --- Triggered abilities that TARGET a subject bound from the event ---
    def({
      oracleId: 'vindictive-ghost',
      name: 'Vindictive Ghost',
      types: ['creature'],
      cost: '2B',
      power: 2,
      toughness: 2,
      // "Whenever another creature is destroyed, deal 2 damage to that creature's controller."
      triggers: [
        {
          on: { kind: 'destroyed', who: 'other', cardType: 'creature' },
          bind: 'eventCardController',
          effect: [{ op: 'dealDamage', amount: 2 }],
        },
      ],
    }),
    def({
      oracleId: 'toll-keeper',
      name: 'Toll Keeper',
      types: ['creature'],
      cost: '1R',
      power: 1,
      toughness: 2,
      // "Whenever an opponent draws a card, deal 1 damage to that player."
      triggers: [
        {
          on: { kind: 'cardDrawn', by: 'opponent' },
          bind: 'eventPlayer',
          effect: [{ op: 'dealDamage', amount: 1 }],
        },
      ],
    }),
  ].map((d) => [d.oracleId, d]),
);

export function getDef(oracleId: string): CardDef {
  const d = CARD_DEFS[oracleId];
  if (!d) throw new Error(`Unknown card oracleId: ${oracleId}`);
  return d;
}

export function isPermanentType(d: CardDef): boolean {
  return d.types.some((t) => t === 'creature' || t === 'artifact' || t === 'enchantment' || t === 'land');
}
