// Preset decks for the rules engine. 15 cards each (all start in hand).

export interface DeckPreset {
  id: string;
  name: string;
  cards: string[];
}

const dup = (n: number, id: string) => Array.from({ length: n }, () => id);

export const PRESET_DECKS: DeckPreset[] = [
  {
    id: 'monkey',
    name: '원숭이 덱',
    cards: [
      ...dup(10, 'stone-monkey'),
      ...dup(3, 'foolish-old-man'),
      ...dup(2, 'monkey-king'),
    ],
  },
  {
    id: 'basic',
    name: '기본 덱',
    cards: dup(15, 'stone-monkey'),
  },
];

export function deckById(id: string): DeckPreset {
  return PRESET_DECKS.find((d) => d.id === id) ?? PRESET_DECKS[0];
}
