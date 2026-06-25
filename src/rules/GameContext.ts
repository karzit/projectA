import type { ChoiceRequest, PlayerId } from './types.js';
import type { Board } from './Board.js';
import type { EventManager } from './EventManager.js';

// Thrown by ChoicesCursor.request when the player has not supplied enough legal
// choices. Game.apply catches it, rolls back, and surfaces the request.
export class ChoiceRequired extends Error {
  constructor(readonly request: ChoiceRequest) {
    super('choice required');
  }
}

export interface ChoiceSpec {
  from: string[];   // legal selectable ids
  min?: number;     // default 1
  max?: number;     // default = min (exact count). For "up to N": min 0, max N.
  prompt?: string;
}

export class ChoicesCursor {
  private i = 0;
  constructor(
    private readonly list: string[],
    private readonly player: PlayerId,
    private readonly cardId: string,
  ) {}

  // Consume the next contiguous block of supplied choices that are legal for
  // this request (in `from`, no duplicates), up to `max`. If fewer than `min`
  // are available, throw ChoiceRequired so the player can be prompted.
  request(spec: ChoiceSpec): string[] {
    const min = spec.min ?? 1;
    const max = spec.max ?? min;
    const out: string[] = [];
    while (this.i < this.list.length && out.length < max) {
      const cand = this.list[this.i];
      if (!spec.from.includes(cand) || out.includes(cand)) break;
      out.push(cand);
      this.i++;
    }
    if (out.length < min) {
      throw new ChoiceRequired({
        player: this.player,
        cardId: this.cardId,
        prompt: spec.prompt ?? '',
        from: spec.from,
        min,
        max,
      });
    }
    return out;
  }

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
  return { controller, cardId, unitId, choices: new ChoicesCursor(choices, controller, cardId), board, events };
}
