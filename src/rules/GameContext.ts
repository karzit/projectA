import type { PlayerId } from './types.js';
import type { Board } from './Board.js';
import type { EventManager } from './EventManager.js';

export class ChoicesCursor {
  private i = 0;
  constructor(private readonly list: string[]) {}

  take(n: number): string[] {
    const out = this.list.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }

  peek(n: number): string[] {
    return this.list.slice(this.i, this.i + n);
  }
}

export interface GameContext {
  controller: PlayerId;
  cardId: string;
  unitId?: string;
  choices: ChoicesCursor;
  board: Board;
  events: EventManager;
}

export function makeContext(
  unitId: string | undefined,
  controller: PlayerId,
  cardId: string,
  board: Board,
  events: EventManager,
  choices: string[] = [],
): GameContext {
  return { controller, cardId, unitId, choices: new ChoicesCursor(choices), board, events };
}
