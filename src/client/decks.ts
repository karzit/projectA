// Preset decks for the menu's deck picker. Built only from the sample card pool
// in the engine. (When the rules/card data are reconfigured later, this list is
// the single place to update.)

const dup = (n: number, id: string) => Array.from({ length: n }, () => id);

export interface DeckPreset {
  id: string;
  name: string;
  cards: string[];
}

export const PRESET_DECKS: DeckPreset[] = [
  {
    id: 'gruul',
    name: 'Gruul Aggro (R/G)',
    cards: [
      ...dup(9, 'forest'),
      ...dup(8, 'mountain'),
      ...dup(4, 'grizzly-bears'),
      ...dup(4, 'goblin-raider'),
      ...dup(3, 'hill-giant'),
      ...dup(4, 'lightning-strike'),
    ],
  },
  {
    id: 'boros',
    name: 'Boros Skies (R/W)',
    cards: [
      ...dup(9, 'plains'),
      ...dup(8, 'mountain'),
      ...dup(4, 'serra-angel'),
      ...dup(4, 'goblin-raider'),
      ...dup(4, 'lightning-strike'),
      ...dup(3, 'healing-salve'),
    ],
  },
  {
    id: 'simic',
    name: 'Simic Tempo (U/G)',
    cards: [
      ...dup(9, 'island'),
      ...dup(9, 'forest'),
      ...dup(6, 'grizzly-bears'),
      ...dup(4, 'divination'),
      ...dup(4, 'healing-salve'),
    ],
  },
];

export function deckById(id: string): DeckPreset {
  return PRESET_DECKS.find((d) => d.id === id) ?? PRESET_DECKS[0];
}
