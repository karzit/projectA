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
    id: 'basic',
    name: '기본 덱',
    preset: true,
    cards: dup(15, 'stone-monkey'),
  },
  {
    id: 'heroic',
    name: '영웅담 덱',
    preset: true,
    // 용사 레벨업 + 결속/액티브(전사·사제·마법사) + 교회 부활 + 성검, 모험의
    // 시작으로 적 퀘스트 체인(→ 마왕 강림)까지 여는 완결형 영웅담 덱.
    cards: [
      ...dup(3, 'hero'),
      ...dup(2, 'warrior'),
      ...dup(2, 'priest'),
      ...dup(2, 'mage'),
      ...dup(2, 'health-potion'),
      ...dup(1, 'foolish-old-man'),
      ...dup(1, 'adventure-start'),
      ...dup(1, 'church'),
      ...dup(1, 'holy-sword'),
    ],
  },
  {
    id: 'journey',
    name: '서유기 덱',
    preset: true,
    cards: [
      ...dup(1, 'tang-monk'),
      ...dup(1, 'je-o-neung'),
      ...dup(1, 'sa-o-jeong'),
      ...dup(1, 'monkey-king'),
      ...dup(1, 'subori-josa'),
      ...dup(1, 'foolish-old-man'),
      ...dup(1, 'guard'),        // 2→1
      ...dup(1, 'inn'),          // 신규: 패악질 자기파괴(-2/0) 청소, 부동 시너지
      ...dup(7, 'stone-monkey'),
    ],
  },
  {
    id: 'cult',
    name: '사교도 덱',
    preset: true,
    cards: [
      ...dup(1, 'cult-ritual'),
      ...dup(1, 'slime'),
      ...dup(2, 'skeleton'),
      ...dup(1, 'skeleton-soldier'),
      ...dup(3, 'stone-monkey'),   // 1→3, third-ritual 병목 해소
      ...dup(5, 'cultist'),
      ...dup(1, 'dark-arts-mind-seal'),
      ...dup(1, 'trap'),           // dark-arts-turmoil 대신 — 미검증
      ...dup(1, 'hospitality'),
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
