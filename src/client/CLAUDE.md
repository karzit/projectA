# src/client — Canvas UI (drives the src/rules ruleset)

The browser client for `src/rules` (the custom ruleset). It used to drive
`src/engine` (MTG-style) but was repointed at `src/rules`. Full project map:
`/CLAUDE.md`.

## The one-way flow — do not break it

```
input → EventManager(intent) → App.applyIntent → game.apply(action)
      → state:changed (HUD/log) → markDirty layers
```

- All state changes go through `game.apply`. UI/input never mutate game state —
  they emit an `intent` (a `RulesAction`) on the bus.
- `App.ts` is the composition root and the ONLY place wiring all pieces. The
  `game.apply` call there is the seam a WebSocket transport would replace.
- There is **no `engine:event` stream**. The renderer/log render from each new
  `GameState` snapshot; `App.logAction` derives human-readable log lines from the
  applied action.
- Managers/renderer/input/ui communicate through `EventManager`'s typed bus
  (`core/events.ts` is the event contract). Keep them decoupled — no direct refs.

## Layer ownership (who draws/owns what)

- `core/CanvasManager` — layered canvases, HiDPI, the fixed-step RAF loop. Loop
  marks layers dirty only while animating, so it idles at rest.
- `render/layout.ts` — the shared source of truth for positions: the renderer AND
  hit-testing both consume it (what you see == what you can click). Each card has
  a stable `key` (instanceId for field units, `hand:P:N` for hand slots).
- `render/Animator` — eases toward layout targets; fade-outs for departed cards.
- `input/InteractionLayer` — pointer/keyboard → intents (drag/double-click to
  play, drop-zone, click-to-attack, DOM hover/배경 zoom panels). `ui/*` — DOM
  overlay (HUD/log/menu) above the canvas.

## Verify (browser)

Use the preview tools: `preview_start` → screenshot. The RAF loop runs forever, so
a screenshot may need a retry; always check `preview_console_logs` for errors.
`npm run typecheck` is the correctness gate (vite build does not typecheck).
