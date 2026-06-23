// Browser entry point. Find the mount node, build the App, start it. The menu
// (deck picker) drives the rest. Run with `npm run dev`.

import { App } from './App.js';

const container = document.getElementById('game');
if (!container) throw new Error('#game container not found');

const app = new App({ container, seed: 42 });

app.start().catch((err) => console.error('failed to start app', err));

// Expose for quick console poking during development.
(window as unknown as { app: App }).app = app;
