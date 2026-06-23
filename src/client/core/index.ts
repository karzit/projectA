// Public surface of the client core (the manager layer).
export { EventBus } from './EventBus.js';
export type { EventMap, Listener } from './EventBus.js';
export { EventManager } from './EventManager.js';
export type { AppEvents, PointerInfo } from './events.js';
export { ResourceManager } from './ResourceManager.js';
export type { ResourceManifest } from './ResourceManager.js';
export { CanvasManager } from './CanvasManager.js';
export type { Layer, LayerRenderer, CanvasManagerOptions } from './CanvasManager.js';
