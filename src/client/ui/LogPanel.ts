// Scrolling game log. Shows action results and key game events.
// Collapsed by default; toggle button in corner to expand.

export class LogPanel {
  private readonly el: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private count = 0;
  private open = false;

  constructor(parent: HTMLElement) {
    this.toggle = document.createElement('button');
    this.toggle.className = 'log-toggle';
    this.toggle.addEventListener('click', () => this._setOpen(!this.open));

    this.el = document.createElement('div');
    this.el.className = 'log-panel log-panel--hidden';

    parent.append(this.toggle, this.el);
    this._updateToggle();
  }

  clear(): void {
    this.el.innerHTML = '';
    this.count = 0;
    this._updateToggle();
  }

  push(text: string, cls = ''): void {
    const row = document.createElement('div');
    row.className = `row ${cls}`.trim();
    row.textContent = text;
    this.el.append(row);
    this.el.scrollTop = this.el.scrollHeight;
    this.count++;
    this._updateToggle();
  }

  private _setOpen(val: boolean): void {
    this.open = val;
    this.el.classList.toggle('log-panel--hidden', !val);
    this._updateToggle();
  }

  private _updateToggle(): void {
    this.toggle.textContent = this.open ? '로그 ✕' : `로그 ${this.count}`;
  }
}
