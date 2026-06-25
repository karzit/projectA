// The application's event contract. This single map is the seam between layers:
//
//   DOM input ──pointer:*──▶ InteractionLayer ──intent (RulesAction)──▶ game
//   game ──state:changed (GameState)──▶ HUD

import type { RulesAction, GameState } from '../../rules/index.js';

export interface PointerInfo {
  x: number;
  y: number;
  button: number; // 0 = primary, 2 = secondary
}

export interface AppEvents {
  // raw input
  'pointer:down': PointerInfo;
  'pointer:move': { x: number; y: number };
  'pointer:up': PointerInfo;
  'key:down': { code: string; key: string };

  // viewport
  'viewport:resize': { width: number; height: number; dpr: number };

  // resource loading
  'resource:progress': { loaded: number; total: number };
  'resource:ready': { total: number };
  'resource:error': { name: string; message: string };

  // one-way game flow
  'intent': RulesAction;
  'state:changed': { state: GameState };

  // generic
  'error': { message: string; cause?: unknown };
}
