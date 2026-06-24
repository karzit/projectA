# src/client — Canvas UI (drives the MTG-style src/engine)

The browser client for `src/engine` (the MTG-style engine), not the `src/rules`
ruleset. Full project map: `/CLAUDE.md`.

## The one-way flow — do not break it

```
input → EventManager(intent) → App.applyIntent → reduce(state, action)
      → engine:event (renderer/log) + state:changed (HUD) → markDirty layers
```

- All state changes go through the engine `reduce`. UI/input never mutate game
  state — they emit an `intent` (an engine `Action`) on the bus.
- `App.ts` is the composition root and the ONLY place wiring all pieces. The
  `reduce` call there is the seam a WebSocket transport would replace.
- Managers/renderer/input/ui communicate through `EventManager`'s typed bus
  (`core/events.ts` is the event contract). Keep them decoupled — no direct refs.

## Layer ownership (who draws/owns what)

- `core/CanvasManager` — layered canvases, HiDPI, the fixed-step RAF loop. Loop
  marks layers dirty only while animating, so it idles at rest.
- `render/layout.ts` — the shared source of truth for positions: the renderer AND
  hit-testing both consume it (what you see == what you can click).
- `render/Animator` — eases toward layout targets; fade-outs; floating numbers;
  state-derived target/combat arrows.
- `input/InteractionLayer` — pointer/keyboard → intents (drag-to-play, drop-zone,
  targeting). `ui/*` — DOM overlay (HUD/log/menu) above the canvas.

## Verify (browser)

Use the preview tools: `preview_start` → screenshot. The RAF loop runs forever, so
a screenshot may need a retry; always check `preview_console_logs` for errors.
`npm run typecheck` is the correctness gate (vite build does not typecheck).
