// The application's event contract. This single map is the seam between layers:
//
//   DOM input ──pointer:*──▶ InteractionLayer ──intent (Action)──▶ engine/server
//   engine/server ──engine:event (GameEvent)──▶ Renderer (animation)
//
// Because intents are engine `Action`s and notifications are engine
// `GameEvent`s, the client speaks exactly the engine's language — the same
// messages a networked client would send to / receive from an authoritative
// server.

import type { Action, GameEvent, GameState } from '../../engine/index.js';

export interface PointerInfo {
  x: number; // local coordinates, relative to the canvas container's top-left
  y: number;
  button: number; // 0 = primary, 2 = secondary, ...
}

export interface AppEvents {
  // --- raw input (emitted by EventManager from DOM) ---
  'pointer:down': PointerInfo;
  'pointer:move': { x: number; y: number };
  'pointer:up': PointerInfo;
  'key:down': { code: string; key: string };

  // --- viewport ---
  'viewport:resize': { width: number; height: number; dpr: number };

  // --- resource loading ---
  'resource:progress': { loaded: number; total: number };
  'resource:ready': { total: number };
  'resource:error': { name: string; message: string };

  // --- the one-way game flow ---
  'intent': Action; // a player-initiated action, on its way to the engine/server
  'engine:event': GameEvent; // an authoritative result, on its way to the renderer
  'state:changed': { state: GameState }; // a new authoritative snapshot (for HUD/log)

  // --- generic ---
  'error': { message: string; cause?: unknown };
}
