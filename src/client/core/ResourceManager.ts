// Loads and caches game assets: card art / atlases (images), fonts, and JSON
// data (e.g. card definitions). One `loadAll(manifest)` call resolves when
// everything is ready, reporting progress along the way so a loading screen can
// render. After that, lookups are synchronous (`getImage`, `getData`).

import type { EventBus } from './EventBus.js';
import type { AppEvents } from './events.js';

export interface ResourceManifest {
  images?: Record<string, string>; // name -> url
  data?: Record<string, string>; // name -> url (fetched as JSON)
  fonts?: Record<string, { url: string; family: string }>; // name -> font face
}

export class ResourceManager {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly data = new Map<string, unknown>();
  private readonly fonts = new Set<string>();

  constructor(private readonly bus?: EventBus<AppEvents>) {}

  async loadAll(manifest: ResourceManifest): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    const imageEntries = Object.entries(manifest.images ?? {});
    const dataEntries = Object.entries(manifest.data ?? {});
    const fontEntries = Object.entries(manifest.fonts ?? {});
    const total = imageEntries.length + dataEntries.length + fontEntries.length;
    let loaded = 0;

    const done = (name: string) => {
      loaded += 1;
      this.bus?.emit('resource:progress', { loaded, total });
    };
    const fail = (name: string, err: unknown) => {
      this.bus?.emit('resource:error', { name, message: String((err as Error)?.message ?? err) });
      throw err;
    };

    for (const [name, url] of imageEntries) {
      tasks.push(
        this.loadImage(url)
          .then((img) => { this.images.set(name, img); done(name); })
          .catch((e) => fail(name, e)),
      );
    }
    for (const [name, url] of dataEntries) {
      tasks.push(
        fetch(url)
          .then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); })
          .then((json) => { this.data.set(name, json); done(name); })
          .catch((e) => fail(name, e)),
      );
    }
    for (const [name, font] of fontEntries) {
      tasks.push(
        this.loadFont(font.family, font.url)
          .then(() => { this.fonts.add(name); done(name); })
          .catch((e) => fail(name, e)),
      );
    }

    await Promise.all(tasks);
    this.bus?.emit('resource:ready', { total });
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load image: ${url}`));
      img.src = url;
    });
  }

  private async loadFont(family: string, url: string): Promise<void> {
    // FontFace + document.fonts is the modern, reliable way to know a web font
    // is actually ready before we paint text with it.
    const face = new FontFace(family, `url(${url})`);
    await face.load();
    (document as Document & { fonts: FontFaceSet }).fonts.add(face);
  }

  getImage(name: string): HTMLImageElement {
    const img = this.images.get(name);
    if (!img) throw new Error(`Resource (image) not loaded: ${name}`);
    return img;
  }

  getData<T>(name: string): T {
    if (!this.data.has(name)) throw new Error(`Resource (data) not loaded: ${name}`);
    return this.data.get(name) as T;
  }

  has(name: string): boolean {
    return this.images.has(name) || this.data.has(name) || this.fonts.has(name);
  }
}
