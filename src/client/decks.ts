// Deck storage: preset decks + user-created decks persisted in localStorage.

export interface DeckPreset {
  id: string;
  name: string;
  cards: string[];
  readonly preset?: true; // preset decks cannot be deleted
}

const dup = (n: number, id: string) => Array.from({ length: n }, () => id);

const PRESET_DECKS: DeckPreset[] = [
  {
    id: 'monkey',
    name: '원숭이 덱',
    preset: true,
    cards: [
      ...dup(10, 'stone-monkey'),
      ...dup(3, 'foolish-old-man'),
      ...dup(2, 'monkey-king'),
    ],
  },
  {
    id: 'basic',
    name: '기본 덱',
    preset: true,
    cards: dup(15, 'stone-monkey'),
  },
  {
    id: 'heroic',
    name: '영웅담 덱',
    preset: true,
    cards: [
      ...dup(3, 'hero'),
      ...dup(3, 'adventure-start'),
      ...dup(4, 'health-potion'),
      ...dup(3, 'foolish-old-man'),
      ...dup(2, 'stone-monkey'),
    ],
  },
];

const LS_KEY = 'ccg_user_decks';

function loadUserDecks(): DeckPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as DeckPreset[]) : [];
  } catch {
    return [];
  }
}

function saveUserDecks(decks: DeckPreset[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(decks.filter((d) => !d.preset)));
}

export function allDecks(): DeckPreset[] {
  return [...PRESET_DECKS, ...loadUserDecks()];
}

export function deckById(id: string): DeckPreset {
  return allDecks().find((d) => d.id === id) ?? PRESET_DECKS[0];
}

export function saveDeck(deck: DeckPreset): void {
  const user = loadUserDecks().filter((d) => d.id !== deck.id);
  saveUserDecks([...user, deck]);
}

export function deleteDeck(id: string): void {
  saveUserDecks(loadUserDecks().filter((d) => d.id !== id));
}

export function newDeckId(): string {
  return `user_${Date.now()}`;
}
