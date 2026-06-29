// Deck management screen: deck list + per-deck card editor.
// Mounted by Overlay; entirely self-contained (no external deps beyond rules index + decks).

import { CARD_REGISTRY } from '../../rules/index.js';
import { allDecks, saveDeck, deleteDeck, newDeckId } from '../decks.js';
import type { DeckPreset } from '../decks.js';

const DECK_SIZE = 15;

export class DeckEditor {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly onBack: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'deck-editor';
    parent.append(this.root);
    this._showList();
  }

  destroy(): void {
    this.root.remove();
  }

  // ── Deck list ──────────────────────────────────────────────────────────────

  private _showList(): void {
    this.root.innerHTML = '';

    const header = div('de-header');
    const backBtn = btn('← 로비', 'ghost de-back', () => this.onBack());
    const title = el('h2', '덱 편성');
    header.append(backBtn, title);

    const list = div('de-list');
    for (const deck of allDecks()) {
      list.append(this._deckRow(deck));
    }

    const newBtn = btn('＋ 새 덱 만들기', 'ghost de-new', () => {
      const d: DeckPreset = { id: newDeckId(), name: '새 덱', cards: [] };
      saveDeck(d);
      this._showEdit(d);
    });

    this.root.append(header, list, newBtn);
  }

  private _deckRow(deck: DeckPreset): HTMLDivElement {
    const row = div('de-row');

    const info = div('de-row-info');
    const name = el('span', deck.name);
    name.className = 'de-row-name';
    const count = el('span', `${deck.cards.length}장`);
    count.className = 'de-row-count';
    info.append(name, count);

    const actions = div('de-row-actions');
    const editBtn = btn('편집', 'ghost de-action', () => this._showEdit({ ...deck, cards: [...deck.cards] }));
    actions.append(editBtn);

    if (!deck.preset) {
      const delBtn = btn('삭제', 'ghost de-action de-del', () => {
        deleteDeck(deck.id);
        this._showList();
      });
      actions.append(delBtn);
    }

    row.append(info, actions);
    return row;
  }

  // ── Deck editor ────────────────────────────────────────────────────────────

  private _showEdit(deck: DeckPreset): void {
    this.root.innerHTML = '';

    const cards = [...deck.cards]; // mutable working copy

    const header = div('de-header');
    const cancelBtn = btn('취소', 'ghost de-back', () => this._showList());

    const nameInput = document.createElement('input');
    nameInput.className = 'de-name-input';
    nameInput.value = deck.name;
    nameInput.maxLength = 20;

    const saveBtn = btn('저장', 'primary de-save', () => {
      const saved: DeckPreset = { id: deck.id, name: nameInput.value.trim() || '새 덱', cards };
      saveDeck(saved);
      this._showList();
    });

    header.append(cancelBtn, nameInput, saveBtn);

    // Count bar
    const countBar = div('de-count-bar');
    const countLabel = el('span', `${cards.length} / ${DECK_SIZE}장`);
    countBar.append(countLabel);

    const refreshCount = () => {
      countLabel.textContent = `${cards.length} / ${DECK_SIZE}장`;
      countLabel.style.color = cards.length === DECK_SIZE ? '#5be0a0' : '#9aa6bd';
    };
    refreshCount();

    // Two-column body
    const body = div('de-body');

    // Left: card pool
    const poolCol = div('de-col');
    poolCol.append(el('h3', '카드 풀'));
    const allCards = CARD_REGISTRY.all();
    for (const card of allCards) {
      const m = card.meta;
      const item = div('de-card-item');
      item.append(cardLabel(m.name, m.kind, m.power, m.wisdom));
      const addBtn = btn('＋', 'de-card-btn de-add', () => {
        if (cards.length >= DECK_SIZE) return;
        cards.push(m.id);
        refreshCount();
        rebuildDeck();
      });
      item.append(addBtn);
      poolCol.append(item);
    }

    // Right: deck contents
    const deckCol = div('de-col');
    deckCol.append(el('h3', '편성'));
    const deckList = div('de-deck-list');
    deckCol.append(deckList);

    const rebuildDeck = () => {
      deckList.innerHTML = '';
      // Group by card id for display order, but keep actual array order for saves
      const counts = new Map<string, number>();
      for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, count] of counts) {
        const m = CARD_REGISTRY.getDef(id);
        const item = div('de-card-item');
        const lbl = cardLabel(`${m.name} ×${count}`, m.kind, m.power, m.wisdom);
        const remBtn = btn('－', 'de-card-btn de-rem', () => {
          const idx = cards.lastIndexOf(id);
          if (idx !== -1) cards.splice(idx, 1);
          refreshCount();
          rebuildDeck();
        });
        item.append(lbl, remBtn);
        deckList.append(item);
      }
    };
    rebuildDeck();

    body.append(poolCol, deckCol);
    this.root.append(header, countBar, body);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function btn(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function cardLabel(name: string, kind: string, power?: number, wisdom?: number): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'de-card-label';
  const kindTag = kind === 'unit' ? '유닛' : '주문';
  const stats = kind === 'unit' ? ` ${power ?? 0}/${wisdom ?? 0}` : '';
  s.textContent = `[${kindTag}${stats}] ${name}`;
  return s;
}
