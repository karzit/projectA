// DOM UI styling, injected once. The UI is a DOM overlay on top of the canvas
// stack: the overlay container is click-through (pointer-events: none) so the
// board still receives input, and only interactive controls re-enable pointer
// events.

const CSS = `
.ui-root {
  position: absolute; inset: 0; z-index: 10;
  pointer-events: none;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e9edf6;
  -webkit-user-select: none; user-select: none;
}
.ui-root button { pointer-events: auto; cursor: pointer; }

/* --- HUD --- */
.hud-bar {
  position: absolute; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  padding: 6px 14px; border-radius: 999px;
  background: rgba(10,14,24,0.72); border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(6px);
}
.hud-bar.top { top: 10px; }
.hud-bar.bottom { bottom: 10px; }
.hud-life { font-size: 18px; font-weight: 700; min-width: 64px; }
.hud-life .who { font-size: 11px; font-weight: 500; color: #9aa6bd; margin-left: 4px; }
.hud-pill {
  font-size: 12px; color: #c7d0e2; padding: 3px 10px;
  background: rgba(255,255,255,0.06); border-radius: 999px; white-space: nowrap;
}
.hud-prompt { font-size: 12px; color: #7fd1ff; min-width: 140px; }
.hud-btn {
  font-size: 13px; font-weight: 600; color: #06243a;
  background: #7fd1ff; border: none; border-radius: 8px; padding: 7px 14px;
}
.hud-btn:disabled { background: #3a4256; color: #8a93a7; cursor: default; }
.hud-timer { display: flex; align-items: center; gap: 6px; }
.hud-timer.hidden { display: none; }
.hud-timer .bar { width: 84px; height: 7px; border-radius: 999px; background: rgba(255,255,255,0.12); overflow: hidden; }
.hud-timer .fill { height: 100%; width: 100%; background: #7fd1ff; transition: width 0.12s linear; }
.hud-timer .secs { font-size: 12px; font-variant-numeric: tabular-nums; color: #c7d0e2; min-width: 26px; text-align: right; }
.hud-timer.low .secs { color: #ff5470; font-weight: 700; }

/* --- Log --- */
.log-panel {
  position: absolute; top: 64px; right: 12px; width: 230px; max-height: 42vh;
  overflow-y: auto; pointer-events: auto;
  padding: 8px 10px; border-radius: 10px;
  background: rgba(10,14,24,0.66); border: 1px solid rgba(255,255,255,0.08);
  font-size: 11px; line-height: 1.5; color: #c7d0e2;
}
.log-panel .row { opacity: 0.92; }
.log-panel .row.k-cast { color: #ffd479; }
.log-panel .row.k-damage { color: #ff9a8a; }
.log-panel .row.k-step { color: #8aa0c8; margin-top: 3px; }
.log-panel .row.k-over { color: #ff5470; font-weight: 700; }

/* --- Full-screen screens (menu / loading / game over) --- */
.screen {
  position: absolute; inset: 0; pointer-events: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; background: rgba(5,7,14,0.86); backdrop-filter: blur(3px);
}
.screen.hidden { display: none; }
.screen h1 { font-size: 34px; margin: 0; letter-spacing: 1px; }
.screen h2 { font-size: 20px; margin: 0; color: #c7d0e2; }
.screen .panel {
  display: flex; flex-direction: column; gap: 12px;
  padding: 22px 26px; border-radius: 14px;
  background: rgba(18,24,40,0.9); border: 1px solid rgba(255,255,255,0.1);
  min-width: 320px;
}
.screen label { font-size: 12px; color: #9aa6bd; display: flex; flex-direction: column; gap: 4px; }
.screen select {
  pointer-events: auto; font-size: 14px; padding: 8px 10px; border-radius: 8px;
  background: #0c1322; color: #e9edf6; border: 1px solid rgba(255,255,255,0.14);
}
.screen .primary {
  font-size: 15px; font-weight: 700; color: #06243a;
  background: #7fd1ff; border: none; border-radius: 10px; padding: 11px 18px; margin-top: 4px;
}
.screen .ghost {
  font-size: 13px; color: #c7d0e2; background: transparent;
  border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 8px 14px;
}
.progress { width: 280px; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.12); overflow: hidden; }
.progress > div { height: 100%; width: 0%; background: #7fd1ff; transition: width 0.15s ease; }
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
