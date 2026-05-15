import { setIcon } from 'obsidian';
import { Card, Connection } from './file-types';

export type CtxEvent =
  | { type: 'delete' }
  | { type: 'tile-edit' }
  | { type: 'sticky-format'; cmd: string }
  | { type: 'sticky-color'; hex: string }
  | { type: 'sticky-top-color'; hex: string | null }
  | { type: 'checklist-accent'; hex: string }
  | { type: 'checklist-bg'; hex: string }
  | { type: 'checklist-top-color'; hex: string | null }
  | { type: 'checklist-title' }
  | { type: 'image-caption' }
  | { type: 'notelink-display' }
  | { type: 'notelink-open' }
  | { type: 'bookmark-refresh' }
  | { type: 'bookmark-copy-url' }
  | { type: 'kanban-color'; hex: string }
  | { type: 'kanban-bg'; hex: string | null }
  | { type: 'kanban-top-color'; hex: string | null }
  | { type: 'kanban-title' }
  | { type: 'kanban-add-col' }
  | { type: 'conn-style' }
  | { type: 'conn-color'; hex: string }
  | { type: 'conn-arrow' }
  | { type: 'conn-route' };

// ── Colour palettes ───────────────────────────────────────────────────────────

const STICKY_COLORS  = ['#FDE68A','#FCA5A5','#86EFAC','#93C5FD','#C4B5FD','#FBB6CE','#FCD34D','#A7F3D0','#D1D5DB','#F3F4F6'];
const KANBAN_COLORS  = ['#6b7280','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899'];
const ACCENT_COLORS  = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#6b7280','#14b8a6','#f43f5e','#8b5cf6','#84cc16'];
const CONN_COLORS    = ['#6b7280','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899'];

const BG_COLORS   = ['#FFFFFF','#F3F4F6','#FEF9C3','#FEE2E2','#D1FAE5','#DBEAFE','#EDE9FE','#FCE7F3','#ECFDF5','#FFF7ED','#F0F9FF','#E0F2FE'];
const STRIP_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#6b7280','#14b8a6','#f43f5e','#1d4ed8','#84cc16'];

// ── ContextBar ────────────────────────────────────────────────────────────────

export class ContextBar {
  private ctxPanelEl!: HTMLElement;
  private trashConfirmActive = false;
  private trashTimeout: number | null = null;
  private currentCard: Card | null = null;
  private currentConn: Connection | null = null;

  constructor(
    private readonly toolbarEl: HTMLElement,
    private readonly emit: (e: CtxEvent) => void,
  ) {
    this.ctxPanelEl = this.toolbarEl.createDiv('ib-ctx-panel');
    this.ctxPanelEl.style.pointerEvents = 'none';
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  show(card: Card): void {
    this.currentCard = card;
    this.currentConn = null;
    this.fill(card);
    this.activate();
  }

  showConn(conn: Connection): void {
    this.currentCard = null;
    this.currentConn = conn;
    this.fillConn(conn);
    this.activate();
  }

  hide(): void {
    this.currentCard = null;
    this.currentConn = null;
    this.deactivate();
  }

  destroy(): void {
    if (this.trashTimeout !== null) window.clearTimeout(this.trashTimeout);
  }

  // ── Panel activation ─────────────────────────────────────────────────────────

  private activate(): void {
    this.toolbarEl.addClass('ib-ctx-active');
    this.ctxPanelEl.style.pointerEvents = '';
  }

  private deactivate(): void {
    this.toolbarEl.removeClass('ib-ctx-active');
    this.ctxPanelEl.style.pointerEvents = 'none';
    this.cancelTrashConfirm();
  }

  // ── Fill by card type ────────────────────────────────────────────────────────

  private fill(card: Card): void {
    const p = this.ctxPanelEl;
    p.empty();
    this.cancelTrashConfirm();

    this.mkBack(p, () => this.hide());

    switch (card.kind) {
      case 'tile':
        this.mkBtn(p, 'Edit', 'edit-2', () => this.emit({ type: 'tile-edit' }));
        break;

      case 'sticky':
        this.mkFmtBtn(p, 'Bold',   'bold',          'strong');
        this.mkFmtBtn(p, 'Italic', 'italic',         'em');
        this.mkFmtBtn(p, 'Under',  'underline',      'u');
        this.mkFmtBtn(p, 'Strike', 'strikethrough',  's');
        this.mkBtn(p, 'Color', 'palette', () => this.openBgTopColorSub(
          p, card,
          BG_COLORS,
          hex => this.emit({ type: 'sticky-color', hex }),
          STRIP_COLORS,
          hex => this.emit({ type: 'sticky-top-color', hex }),
        ));
        break;

      case 'checklist':
        this.mkBtn(p, 'Color', 'palette', () => this.openBgTopColorSub(
          p, card,
          BG_COLORS,
          hex => this.emit({ type: 'checklist-bg', hex }),
          ACCENT_COLORS,
          hex => this.emit({ type: 'checklist-top-color', hex }),
        ));
        this.mkBtn(p, 'Title', 'heading', () => this.emit({ type: 'checklist-title' }));
        break;

      case 'image':
        this.mkBtn(p, 'Caption', 'align-left', () => this.emit({ type: 'image-caption' }));
        break;

      case 'note-link':
        this.mkBtn(p, 'Display', 'layout-list',   () => this.emit({ type: 'notelink-display' }));
        this.mkBtn(p, 'Open',    'external-link', () => this.emit({ type: 'notelink-open' }));
        break;

      case 'bookmark':
        this.mkBtn(p, 'Refresh',  'refresh-cw', () => this.emit({ type: 'bookmark-refresh' }));
        this.mkBtn(p, 'Copy URL', 'copy',        () => this.emit({ type: 'bookmark-copy-url' }));
        break;

      case 'kanban-column':
        this.mkBtn(p, 'Color', 'palette', () => this.openBgTopColorSub(
          p, card,
          BG_COLORS,
          hex => this.emit({ type: 'kanban-bg', hex }),
          STRIP_COLORS,
          hex => this.emit({ type: 'kanban-top-color', hex }),
        ));
        this.mkBtn(p, 'Title',   'heading', () => this.emit({ type: 'kanban-title' }));
        this.mkBtn(p, 'Add col', 'columns', () => this.emit({ type: 'kanban-add-col' }));
        break;

      case 'audio':
        // no specific actions
        break;
    }

    this.mkTrash(p);
  }

  private fillConn(conn: Connection): void {
    const p = this.ctxPanelEl;
    p.empty();
    this.cancelTrashConfirm();

    this.mkBack(p, () => this.hide());
    this.mkBtn(p, 'Style',  'minus',       () => this.emit({ type: 'conn-style' }));
    this.mkBtn(p, 'Color',  'palette',     () => this.openConnColorSub(p, conn));
    this.mkBtn(p, 'Arrow',  'arrow-right', () => this.emit({ type: 'conn-arrow' }));
    this.mkBtn(p, 'Route',  'git-branch',  () => this.emit({ type: 'conn-route' }));
    this.mkTrash(p);
  }

  // ── Background + Top strip two-tab picker ────────────────────────────────────

  private openBgTopColorSub(
    p: HTMLElement,
    card: Card,
    bgColors: string[],
    onBg: (hex: string) => void,
    stripColors: string[],
    onStrip: (hex: string | null) => void,
  ): void {
    p.empty();
    this.cancelTrashConfirm();
    this.mkBack(p, () => this.fill(card));

    // Tab row
    const tabRow = p.createDiv('ib-ctx-tab-row');
    const bgTab    = tabRow.createDiv('ib-ctx-tab ib-ctx-tab--active');
    bgTab.setText('Background');
    const stripTab = tabRow.createDiv('ib-ctx-tab');
    stripTab.setText('Top strip');

    // Swatch area (re-rendered on tab switch)
    const swatchArea = p.createDiv('ib-ctx-swatch-area');

    const renderSwatches = (tab: 'bg' | 'strip') => {
      swatchArea.empty();
      if (tab === 'bg') {
        const grid = swatchArea.createDiv('ib-ctx-color-grid');
        for (const hex of bgColors) {
          const sw = grid.createDiv('ib-ctx-color-swatch');
          sw.style.background = hex;
          if (['#FFFFFF','#F3F4F6','#E0F2FE','#F0F9FF'].includes(hex))
            sw.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.12)';
          sw.addEventListener('click', () => onBg(hex));
        }
        this.mkCustomColor(swatchArea, onBg, () => {});
      } else {
        const grid = swatchArea.createDiv('ib-ctx-color-grid');
        // "None" swatch removes the strip
        const noneSw = grid.createDiv('ib-ctx-color-swatch ib-ctx-color-swatch--none');
        noneSw.setAttribute('aria-label', 'None');
        noneSw.addEventListener('click', () => onStrip(null));
        for (const hex of stripColors) {
          const sw = grid.createDiv('ib-ctx-color-swatch');
          sw.style.background = hex;
          sw.addEventListener('click', () => onStrip(hex));
        }
        this.mkCustomColor(swatchArea, onStrip, () => {});
      }
    };

    bgTab.addEventListener('click', () => {
      bgTab.addClass('ib-ctx-tab--active');
      stripTab.removeClass('ib-ctx-tab--active');
      renderSwatches('bg');
    });
    stripTab.addEventListener('click', () => {
      stripTab.addClass('ib-ctx-tab--active');
      bgTab.removeClass('ib-ctx-tab--active');
      renderSwatches('strip');
    });

    renderSwatches('bg');
    this.mkTrash(p);
  }

  // ── Color sub-panel ──────────────────────────────────────────────────────────

  private openColorSub(
    p: HTMLElement,
    colors: string[],
    onSelect: (hex: string) => void,
    card: Card,
  ): void {
    p.empty();
    this.cancelTrashConfirm();
    this.mkBack(p, () => this.fill(card));

    const grid = p.createDiv('ib-ctx-color-grid');
    for (const hex of colors) {
      const sw = grid.createDiv('ib-ctx-color-swatch');
      sw.style.background = hex;
      if (['#F3F4F6','#D1D5DB'].includes(hex))
        sw.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.15)';
      sw.addEventListener('click', () => { onSelect(hex); this.fill(card); });
    }

    this.mkCustomColor(p, onSelect, () => this.fill(card));
    this.mkTrash(p);
  }

  private openConnColorSub(p: HTMLElement, conn: Connection): void {
    p.empty();
    this.cancelTrashConfirm();
    this.mkBack(p, () => this.fillConn(conn));

    const grid = p.createDiv('ib-ctx-color-grid');
    for (const hex of CONN_COLORS) {
      const sw = grid.createDiv('ib-ctx-color-swatch');
      sw.style.background = hex;
      sw.addEventListener('click', () => { this.emit({ type: 'conn-color', hex }); this.fillConn(conn); });
    }

    this.mkCustomColor(p, hex => this.emit({ type: 'conn-color', hex }), () => this.fillConn(conn));
    this.mkTrash(p);
  }

  private mkCustomColor(p: HTMLElement, onSelect: (hex: string) => void, onBack: () => void): void {
    const inp = p.createEl('input') as HTMLInputElement;
    inp.type = 'color';
    inp.addClass('ib-ctx-color-wheel-input');
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    inp.addEventListener('change', () => { onSelect(inp.value); onBack(); });

    const btn = this.mkBtn(p, 'Custom', 'pipette', () => inp.click());
    btn.prepend(inp);
  }

  // ── Button helpers ───────────────────────────────────────────────────────────

  private mkFmtBtn(parent: HTMLElement, label: string, icon: string, tag: string): HTMLElement {
    const btn = this.mkBtn(parent, label, icon, () => this.emit({ type: 'sticky-format', cmd: tag }));
    // Prevent focus from leaving the sticky editor when the button is clicked
    btn.addEventListener('pointerdown', e => e.preventDefault());
    return btn;
  }

  private mkBtn(parent: HTMLElement, label: string, icon: string, handler: () => void): HTMLElement {
    const btn = parent.createDiv('icon-board-tb-btn');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', label);
    const ic = btn.createDiv('icon-board-tb-btn-icon');
    setIcon(ic, icon);
    btn.createEl('span', { text: label, cls: 'icon-board-tb-btn-label' });
    btn.addEventListener('click', handler);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    return btn;
  }

  private mkBack(parent: HTMLElement, handler: () => void): void {
    const back = parent.createDiv('ib-ctx-back-btn');
    back.setAttribute('tabindex', '0');
    back.setAttribute('aria-label', 'Back');
    setIcon(back, 'arrow-left');
    back.addEventListener('click', handler);
    back.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  }

  private mkTrash(parent: HTMLElement): void {
    parent.createDiv('ib-ctx-spacer');
    parent.createDiv('ib-ctx-trash-sep');

    let labelEl: HTMLElement;
    const btn = parent.createDiv('icon-board-tb-btn ib-ctx-trash-btn');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Delete');
    const ic = btn.createDiv('icon-board-tb-btn-icon');
    setIcon(ic, 'trash-2');
    labelEl = btn.createEl('span', { text: 'Delete', cls: 'icon-board-tb-btn-label' });

    const confirm = () => {
      if (this.trashConfirmActive) { this.emit({ type: 'delete' }); return; }
      this.trashConfirmActive = true;
      labelEl.setText('Sure?');
      btn.addClass('ib-ctx-trash--confirm');
      if (this.trashTimeout !== null) window.clearTimeout(this.trashTimeout);
      this.trashTimeout = window.setTimeout(() => this.cancelTrashConfirm(), 3000);
    };

    btn.addEventListener('click', confirm);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confirm(); } });
  }

  private cancelTrashConfirm(): void {
    if (this.trashTimeout !== null) { window.clearTimeout(this.trashTimeout); this.trashTimeout = null; }
    this.trashConfirmActive = false;
  }
}
