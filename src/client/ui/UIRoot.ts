// Composes the DOM UI: injects styles, builds overlay container, wires HUD and
// log to the event bus.

import type { GameState, PlayerId } from '../../rules/index.js';
import type { EventManager } from '../core/EventManager.js';
import { injectStyles } from './styles.js';
import { Hud } from './Hud.js';
import { LogPanel } from './LogPanel.js';
import { Overlay } from './Overlay.js';

export interface UIRootDeps {
  events: EventManager;
  getState: () => GameState;
  local: PlayerId;
}

export class UIRoot {
  readonly root: HTMLDivElement;
  readonly hud: Hud;
  readonly log: LogPanel;
  readonly overlay: Overlay;
  private readonly unsubs: Array<() => void> = [];

  constructor(container: HTMLElement, deps: UIRootDeps) {
    injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    container.append(this.root);

    this.hud = new Hud(this.root, deps.events, deps.getState, deps.local);
    this.log = new LogPanel(this.root);
    this.overlay = new Overlay(this.root);

    this.unsubs.push(
      deps.events.on('state:changed', ({ state }) => this.hud.update(state as GameState)),
      deps.events.on('resource:progress', (p) => this.overlay.setProgress(p.loaded, p.total)),
    );
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.root.remove();
  }
}
