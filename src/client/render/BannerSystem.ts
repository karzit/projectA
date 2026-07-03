// C-12: turn-transition banners  C-13: card-play queue banners
// Renders onto the overlay canvas. App.ts calls show* methods and marks
// the overlay dirty while isActive() returns true.

interface BannerEntry {
  text: string;
  sub?: string;
  startMs: number;
  durationMs: number;
  fadeIn: number;
  fadeOut: number;
  color: string;
  bg: string;
  size: 'large' | 'small';
}

export class BannerSystem {
  private turn: BannerEntry | null = null;
  private playQueue: Array<Omit<BannerEntry, 'startMs'>> = [];
  private playActive: BannerEntry | null = null;

  /** C-12: call on every turn change (pass → new active player). */
  showTurn(text: string, isLocal: boolean): void {
    this.turn = {
      text,
      startMs: performance.now(),
      durationMs: 1400,
      fadeIn: 220,
      fadeOut: 340,
      color: isLocal ? '#5be0a0' : '#ff9c70',
      bg: isLocal ? 'rgba(10,46,30,0.88)' : 'rgba(52,18,10,0.88)',
      size: 'large',
    };
  }

  /** C-19: opening → main phase transition. Distinct from regular turn banners
   *  (gold, longer, with a "메인 페이즈" sub-label) so it doesn't read as just
   *  another turn pass. */
  showPhase(text: string, sub: string): void {
    this.turn = {
      text,
      sub,
      startMs: performance.now(),
      durationMs: 2000,
      fadeIn: 260,
      fadeOut: 420,
      color: '#f5c518',
      bg: 'rgba(46,36,6,0.92)',
      size: 'large',
    };
  }

  /** C-13: enqueue a card-play flash. Multiple plays queue up. */
  queuePlay(name: string, sub?: string): void {
    this.playQueue.push({
      text: name,
      sub,
      durationMs: 900,
      fadeIn: 160,
      fadeOut: 240,
      color: '#ffd060',
      bg: 'rgba(38,32,8,0.88)',
      size: 'small',
    });
    if (!this.playActive) this.#nextPlay();
  }

  #nextPlay(): void {
    if (this.playQueue.length === 0) { this.playActive = null; return; }
    this.playActive = { ...this.playQueue.shift()!, startMs: performance.now() };
  }

  /** Returns true while any banner is animating (overlay must stay dirty). */
  isActive(now: number): boolean {
    return this.#alive(this.turn, now) || this.#alive(this.playActive, now);
  }

  #alive(e: BannerEntry | null, now: number): boolean {
    return !!e && now - e.startMs < e.durationMs;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    if (this.turn) {
      const done = this.#draw(ctx, w, h, now, this.turn, h * 0.40);
      if (done) this.turn = null;
    }
    if (this.playActive) {
      const done = this.#draw(ctx, w, h, now, this.playActive, h * 0.56);
      if (done) { this.#nextPlay(); }
    }
  }

  /** Draw one banner; returns true when it has expired. */
  #draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    now: number,
    e: BannerEntry,
    centerY: number,
  ): boolean {
    const elapsed = now - e.startMs;
    if (elapsed >= e.durationMs) return true;

    const { fadeIn, fadeOut, durationMs, text, sub, color, bg, size } = e;
    let alpha: number;
    if (elapsed < fadeIn) alpha = elapsed / fadeIn;
    else if (elapsed > durationMs - fadeOut) alpha = (durationMs - elapsed) / fadeOut;
    else alpha = 1;

    const large = size === 'large';
    const bw = large ? Math.min(w * 0.55, 440) : Math.min(w * 0.46, 340);
    const bh = large ? 54 : 42;
    const bx = (w - bw) / 2;
    const by = centerY - bh / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 10);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = large ? 1.5 : 1;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (sub) {
      ctx.font = `700 ${large ? 19 : 16}px system-ui, sans-serif`;
      ctx.fillText(text, w / 2, by + bh / 2 - 7);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `${large ? 12 : 11}px system-ui, sans-serif`;
      ctx.fillText(sub, w / 2, by + bh / 2 + 9);
    } else {
      ctx.font = `700 ${large ? 21 : 17}px system-ui, sans-serif`;
      ctx.fillText(text, w / 2, by + bh / 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    return false;
  }
}
