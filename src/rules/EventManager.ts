import type { GameEvent, GameState, PlayerId } from './types.js';

// A static-condition subscription: checked on every settle pass until it fires.
export interface StaticSub {
  key: string;
  controller: PlayerId;
  once: boolean;
  check: (state: GameState) => boolean;
  fire: () => void;
}

// An event-driven subscription: fires when a matching GameEvent is emitted.
export interface EventSub {
  key: string;
  controller: PlayerId;
  once?: boolean;
  filter: (ev: GameEvent) => boolean;
  fire: (ev: GameEvent) => void;
}

export class EventManager {
  private staticSubs: StaticSub[] = [];
  private eventSubs: EventSub[] = [];

  onStatic(sub: StaticSub): void {
    this.staticSubs.push(sub);
  }

  on(sub: EventSub): void {
    this.eventSubs.push(sub);
  }

  // Remove all subscriptions whose key starts with the given unitId prefix.
  // Called when a unit leaves the field (destroyed or exits).
  unsubscribeUnit(unitId: string): void {
    this.staticSubs = this.staticSubs.filter((s) => !s.key.startsWith(`${unitId}:`));
    this.eventSubs = this.eventSubs.filter((s) => !s.key.startsWith(`${unitId}:`));
  }

  // Clear all subscriptions (used by syncSubscriptions to rebuild from scratch).
  clear(): void {
    this.staticSubs = [];
    this.eventSubs = [];
  }

  getStaticSubs(): readonly StaticSub[] { return this.staticSubs; }
  getEventSubs(): readonly EventSub[] { return this.eventSubs; }
}
