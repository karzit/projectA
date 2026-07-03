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
.hud-field { font-size: 12px; color: #c7d0e2; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hud-pill {
  font-size: 12px; color: #c7d0e2; padding: 3px 10px;
  background: rgba(255,255,255,0.06); border-radius: 999px; white-space: nowrap;
  border: 1px solid transparent;
}
.hud-pill.phase-opening {
  color: #f5c518; background: rgba(245,197,24,0.12); border-color: rgba(245,197,24,0.4);
}
.hud-pill.phase-main {
  color: #7fd1ff; background: rgba(127,209,255,0.10); border-color: rgba(127,209,255,0.3);
}
.hud-env {
  display: none; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-left: 10px; padding-left: 10px;
  border-left: 1px solid rgba(255,255,255,0.12);
}
.hud-env-chip {
  font-size: 11px; color: #ffd580; padding: 2px 8px;
  background: rgba(255,213,128,0.1); border: 1px solid rgba(255,213,128,0.3);
  border-radius: 999px; white-space: nowrap;
}
.hud-menu-btn {
  font-size: 14px; color: #9aa6bd; background: transparent; border: none;
  padding: 2px 6px; cursor: pointer; border-radius: 6px; margin-left: auto;
  line-height: 1;
}
.hud-menu-btn:hover { color: #e9edf6; background: rgba(255,255,255,0.08); }
.hud-prompt { font-size: 12px; color: #7fd1ff; min-width: 140px; }
.hud-btn {
  font-size: 13px; font-weight: 600; color: #06243a;
  background: #7fd1ff; border: none; border-radius: 8px; padding: 7px 14px;
}
.hud-btn:disabled { background: #3a4256; color: #8a93a7; cursor: default; }

/* --- Log --- */
.log-toggle {
  position: absolute; top: 46px; right: 12px;
  font-size: 11px; color: #9aa6bd; background: rgba(10,14,24,0.72);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 999px;
  padding: 3px 10px; cursor: pointer; pointer-events: auto;
  white-space: nowrap; z-index: 20;
}
.log-toggle:hover { color: #e9edf6; background: rgba(20,28,48,0.9); }
.log-panel {
  position: absolute; top: 72px; right: 12px; width: 230px; max-height: 42vh;
  overflow-y: auto; pointer-events: auto;
  padding: 8px 10px; border-radius: 10px;
  background: rgba(10,14,24,0.66); border: 1px solid rgba(255,255,255,0.08);
  font-size: 11px; line-height: 1.5; color: #c7d0e2;
  z-index: 19;
}
.log-panel--hidden { display: none; }
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

/* --- Lobby --- */
.lobby-grid {
  display: flex; flex-direction: column; gap: 10px; min-width: 300px;
}
.lobby-btn {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 2px; padding: 14px 18px; border-radius: 12px; border: none;
  text-align: left; cursor: pointer; width: 100%;
}
.lobby-btn.primary { background: #7fd1ff; color: #06243a; }
.lobby-btn.ghost { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #e9edf6; }
.lobby-btn-label { font-size: 15px; font-weight: 700; }
.lobby-btn-sub { font-size: 11px; opacity: 0.65; }

/* --- Deck Editor --- */
.deck-editor {
  display: flex; flex-direction: column; gap: 12px;
  width: 100%; height: 100%; padding: 16px; box-sizing: border-box; overflow: hidden;
}
.de-header {
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
}
.de-header h2 { margin: 0; font-size: 20px; }
.de-header h3 { margin: 0 0 8px; font-size: 13px; color: #9aa6bd; }
.de-back, .de-new { font-size: 13px; }
.de-save { font-size: 13px; margin-left: auto; }
.de-name-input {
  font-size: 15px; font-weight: 600; color: #e9edf6;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 8px; padding: 6px 10px; flex: 1; max-width: 220px;
}
.de-count-bar { font-size: 13px; color: #9aa6bd; flex-shrink: 0; }
.de-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1; }
.de-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
}
.de-row-info { display: flex; align-items: baseline; gap: 8px; }
.de-row-name { font-size: 14px; font-weight: 600; }
.de-row-count { font-size: 12px; color: #9aa6bd; }
.de-row-actions { display: flex; gap: 6px; }
.de-action { font-size: 12px; padding: 5px 10px !important; }
.de-del { color: #ff7060 !important; border-color: rgba(255,96,80,0.35) !important; }
.de-body {
  display: flex; gap: 14px; flex: 1; overflow: hidden;
}
.de-col {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.de-col h3 { margin: 0 0 6px; font-size: 13px; color: #9aa6bd; flex-shrink: 0; }
.de-deck-list, .de-col > .de-card-item { overflow-y: auto; }
.de-col > .de-card-item ~ .de-card-item { margin-top: 4px; }
.de-deck-list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; flex: 1; }
.de-card-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 8px; border-radius: 7px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
}
.de-card-label { font-size: 12px; color: #c7d0e2; flex: 1; }
.de-card-btn {
  font-size: 14px; font-weight: 700; width: 26px; height: 26px;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.07); color: #e9edf6; flex-shrink: 0; padding: 0;
}
.de-add { color: #5be0a0; border-color: rgba(91,224,160,0.3); }
.de-rem { color: #ff7060; border-color: rgba(255,112,96,0.3); }

/* --- Card zoom / sub-zoom panels --- */
.card-panel {
  position: absolute;
  pointer-events: auto;
  background: rgba(10,15,30,0.97);
  border: 1.5px solid rgba(255,255,255,0.18);
  border-radius: 10px;
  padding: 10px;
  box-sizing: border-box;
  color: #e9edf6;
  font-family: system-ui, sans-serif;
  line-height: 1.4;
  user-select: none;
  z-index: 50;
}
/* panel-right: anchor is left edge, panel opens rightward (default) */
.card-panel.panel-right { transform: translateX(0); }
/* panel-left: anchor is right edge, panel opens leftward */
.card-panel.panel-left  { transform: translateX(-100%); }

/* --- Toast --- */
.toast {
  position: absolute; left: 50%; bottom: 80px; transform: translateX(-50%);
  background: rgba(20,10,10,0.88); border: 1px solid rgba(255,100,80,0.5);
  color: #ff9080; font-size: 13px; font-weight: 600;
  padding: 8px 18px; border-radius: 8px; white-space: nowrap;
  pointer-events: none; z-index: 50;
  animation: toast-in 0.15s ease, toast-out 0.3s ease 1.2s forwards;
}
@keyframes toast-in  { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
@keyframes toast-out { from { opacity: 1; } to { opacity: 0; } }
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
