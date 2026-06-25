// Scrolling game log. Shows action results and key game events.

export class LogPanel {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'log-panel';
    parent.append(this.el);
  }

  clear(): void {
    this.el.innerHTML = '';
  }

  push(text: string, cls = ''): void {
    const row = document.createElement('div');
    row.className = `row ${cls}`.trim();
    row.textContent = text;
    this.el.append(row);
    this.el.scrollTop = this.el.scrollHeight;
  }
}
