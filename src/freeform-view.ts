import {
  App, TFile, TFolder, Menu, Notice, Modal, setIcon,
  MarkdownRenderer, Component, FuzzySuggestModal, requestUrl,
} from 'obsidian';
import {
  IconBoardFile, TileCard, StickyCard, ChecklistCard, NoteLinkCard,
  ImageCard, BookmarkCard, KanbanColumnCard, KanbanItem, Card, Connection,
} from './file-types';
import {
  straightAnchors, elbowAnchors, buildStraightPath, buildElbowPath, resolveOrientation, rectExitPoint,
} from './canvas/geometry';
import { contrastColor } from './color-utils';
import { TileModal } from './tile-modal';
import { snap } from './canvas/snap';
import {
  Viewport, applyWheelZoom, applyPinchZoom,
  viewportTransform, screenToCanvas, clampZoom,
} from './canvas/pan-zoom';
import { SelectionManager } from './canvas/selection';

// ── Constants ──────────────────────────────────────────────────
const TILE_DEFAULT_W      = 140;
const TILE_DEFAULT_H      = 160;
const TILE_MIN_W          = 80;
const TILE_MIN_H          = 100;
const STICKY_DEFAULT_W    = 180;
const STICKY_DEFAULT_H    = 160;
const STICKY_MIN_W        = 120;
const STICKY_MIN_H        = 80;
const CHECKLIST_DEFAULT_W = 220;
const CHECKLIST_DEFAULT_H = 200;
const CHECKLIST_MIN_W     = 160;
const CHECKLIST_MIN_H     = 120;
const NOTELINK_DEFAULT_W  = 280;
const NOTELINK_DEFAULT_H  = 240;
const NOTELINK_TITLE_W    = 220;
const NOTELINK_TITLE_H    = 52;
const NOTELINK_MIN_W      = 160;
const NOTELINK_MIN_H      = 52;
const IMAGE_DEFAULT_W     = 240;
const IMAGE_DEFAULT_H     = 200;
const IMAGE_MIN_W         = 80;
const IMAGE_MIN_H         = 80;
const BOOKMARK_DEFAULT_W  = 260;
const BOOKMARK_DEFAULT_H  = 220;
const BOOKMARK_MIN_W      = 180;
const BOOKMARK_MIN_H      = 100;
const KANBAN_DEFAULT_W    = 220;
const KANBAN_DEFAULT_H    = 340;
const KANBAN_MIN_W        = 160;
const KANBAN_MIN_H        = 200;
const DOT_SPACING         = 32;
const MAX_UNDO            = 20;
const DRAG_THRESHOLD      = 5;
const BOOKMARK_REFETCH_MS = 30 * 24 * 60 * 60 * 1000;

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'ico'];

const CONN_COLOR_PRESETS = [
  '#6b7280', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#a855f7', '#ec4899',
];

const STICKY_COLORS: { color: string; name: string }[] = [
  { color: '#FDE68A', name: 'Yellow' },
  { color: '#FCA5A5', name: 'Rose' },
  { color: '#86EFAC', name: 'Green' },
  { color: '#93C5FD', name: 'Blue' },
  { color: '#C4B5FD', name: 'Purple' },
  { color: '#FBB6CE', name: 'Pink' },
  { color: '#FCD34D', name: 'Amber' },
  { color: '#A7F3D0', name: 'Mint' },
];

const KANBAN_COLORS: { color: string; name: string }[] = [
  { color: '#6b7280', name: 'Gray' },
  { color: '#ef4444', name: 'Red' },
  { color: '#f97316', name: 'Orange' },
  { color: '#eab308', name: 'Yellow' },
  { color: '#22c55e', name: 'Green' },
  { color: '#3b82f6', name: 'Blue' },
  { color: '#a855f7', name: 'Purple' },
  { color: '#ec4899', name: 'Pink' },
];

// ── Type helpers ───────────────────────────────────────────────
type SupportedCard = TileCard | StickyCard | ChecklistCard | NoteLinkCard | ImageCard | BookmarkCard | KanbanColumnCard;

function isSupportedCard(card: Card): card is SupportedCard { return true; }

function cardMinSize(kind: Card['kind']): { w: number; h: number } {
  if (kind === 'sticky')    return { w: STICKY_MIN_W,    h: STICKY_MIN_H    };
  if (kind === 'checklist') return { w: CHECKLIST_MIN_W, h: CHECKLIST_MIN_H };
  if (kind === 'note-link') return { w: NOTELINK_MIN_W,  h: NOTELINK_MIN_H  };
  if (kind === 'image')     return { w: IMAGE_MIN_W,     h: IMAGE_MIN_H     };
  if (kind === 'bookmark')  return { w: BOOKMARK_MIN_W,  h: BOOKMARK_MIN_H  };
  if (kind === 'kanban-column') return { w: KANBAN_MIN_W, h: KANBAN_MIN_H };
  return { w: TILE_MIN_W, h: TILE_MIN_H };
}

function isValidURL(text: string): boolean {
  try { const u = new URL(text); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// ── Helper modals ──────────────────────────────────────────────

class NoteLinkPickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (f: TFile) => void) { super(app); }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.onChoose(f); }
}

class VaultImagePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (f: TFile) => void) { super(app); }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter(f => IMAGE_EXTS.includes(f.extension.toLowerCase()));
  }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.onChoose(f); }
}

class WipLimitModal extends Modal {
  constructor(
    app: App,
    private current: number | undefined,
    private onSubmit: (limit: number | undefined) => void
  ) { super(app); }

  onOpen(): void {
    this.contentEl.createEl('h3', { text: 'WIP Limit' });
    this.contentEl.createEl('p', {
      text: 'Maximum items allowed in this column. Leave blank to remove the limit.',
      cls: 'setting-item-description',
    });
    const input = this.contentEl.createEl('input');
    input.type = 'number'; input.min = '1'; input.placeholder = 'No limit';
    input.style.cssText = 'width:100%;margin-bottom:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;';
    if (this.current !== undefined) input.value = String(this.current);

    const btnRow = this.contentEl.createDiv();
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const setBtn = btnRow.createEl('button', { text: 'Set', cls: 'mod-cta' });
    setBtn.addEventListener('click', () => this.submit(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(input.value); }
      if (e.key === 'Escape') this.close();
    });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  private submit(raw: string): void {
    const val = parseInt(raw.trim());
    this.close();
    this.onSubmit(isNaN(val) || val < 1 ? undefined : val);
  }

  onClose(): void { this.contentEl.empty(); }
}

class TagInputModal extends Modal {
  constructor(app: App, private onSubmit: (tag: string) => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h3', { text: 'Add tag' });
    const input = this.contentEl.createEl('input');
    input.type = 'text'; input.placeholder = 'tag name (no #)';
    input.style.cssText = 'width:100%;margin-bottom:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;';
    const btnRow = this.contentEl.createDiv();
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const addBtn = btnRow.createEl('button', { text: 'Add', cls: 'mod-cta' });
    const submit = () => {
      const val = input.value.trim().replace(/^#/, '').replace(/\s+/g, '-');
      if (!val) return;
      this.close(); this.onSubmit(val);
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });
    setTimeout(() => input.focus(), 50);
  }
  onClose(): void { this.contentEl.empty(); }
}

class BookmarkInputModal extends Modal {
  constructor(app: App, private onSubmit: (url: string) => void) { super(app); }

  onOpen(): void {
    this.contentEl.createEl('h3', { text: 'Add bookmark' });
    const input = this.contentEl.createEl('input', { cls: 'icon-board-bookmark-url-input' });
    input.type = 'text'; input.placeholder = 'https://…';
    input.style.cssText = 'width:100%;margin-bottom:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;';

    const btnRow = this.contentEl.createDiv();
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancel = btnRow.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const add = btnRow.createEl('button', { text: 'Add', cls: 'mod-cta' });
    add.addEventListener('click', () => this.submit(input.value));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(input.value); }
      if (e.key === 'Escape') this.close();
    });
    setTimeout(() => input.focus(), 50);
  }

  private submit(raw: string): void {
    const url = raw.trim();
    if (!isValidURL(url)) { new Notice('Please enter a valid https:// URL.'); return; }
    this.close(); this.onSubmit(url);
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Renderer ───────────────────────────────────────────────────
export class FreeformRenderer extends Component {
  private outer!: HTMLElement;
  private inner!: HTMLElement;
  private marqueeEl!: HTMLElement;
  private zoomPill!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private svgDefs!: SVGDefsElement;
  private connectionPaths = new Map<string, SVGPathElement>();

  private connectMode = false;
  private connectSourceId: string | null = null;
  private ghostPath: SVGPathElement | null = null;
  private connectToolBtn: HTMLElement | null = null;
  private connectMoveListener: ((e: PointerEvent) => void) | null = null;

  private connectionHitPaths = new Map<string, SVGPathElement>();
  private connectionLabelEls = new Map<string, SVGGElement>();
  private connectionSelectPath: SVGPathElement | null = null;
  private selectedConnectionId: string | null = null;
  private connPropsEl: HTMLElement | null = null;

  private vp: Viewport;
  private selection = new SelectionManager();
  private cardEls = new Map<string, HTMLElement>();

  private undoStack: string[] = [];
  private redoStack: string[] = [];

  private spaceDown = false;
  private isPanning = false;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private docKeyDown!: (e: KeyboardEvent) => void;
  private docKeyUp!: (e: KeyboardEvent) => void;

  private pinchDist: number | null = null;
  private pinchMidX = 0;
  private pinchMidY = 0;

  constructor(
    private app: App,
    private container: HTMLElement,
    private board: IconBoardFile,
    private file: TFile,
    private onNavigate: (boardPath: string) => Promise<void>,
    private onSave: (board: IconBoardFile) => Promise<void>,
    private attachmentFolder = 'attachments/icon-board',
    private bookmarkCacheDays = 30
  ) {
    super();
    this.vp = { ...(board.viewport ?? { x: 0, y: 0, zoom: 1 }) };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  render(): void {
    this.container.style.overflow = 'hidden';
    this.container.style.position = 'relative';
    this.container.empty();
    this.cardEls.clear();
    this.connectionPaths.clear();

    this.outer = this.container.createDiv('icon-board-canvas-outer');
    this.outer.setAttribute('tabindex', '0');
    this.inner = this.outer.createDiv('icon-board-canvas-inner');
    this.marqueeEl = this.outer.createDiv('icon-board-marquee');
    this.marqueeEl.style.display = 'none';

    // SVG connection layer goes first so it renders behind cards
    this.initConnectionLayer();

    for (const card of this.board.cards) this.createCardEl(card);
    this.refreshAllConnections();

    this.applyViewport();
    this.bindCanvasEvents();
    this.renderToolbar();
    this.renderZoomPill();

    // Re-fetch stale bookmarks
    for (const card of this.board.cards) {
      if (card.kind !== 'bookmark' || card.fetchFailed) continue;
      if (!card.fetchedAt || Date.now() - card.fetchedAt > this.bookmarkCacheDays * 86_400_000) {
        const el = this.cardEls.get(card.id);
        if (el) this.fetchAndUpdateBookmark(card, el);
      }
    }

    setTimeout(() => this.outer.focus(), 0);
  }

  destroy(): void {
    this.exitConnectMode();
    this.deselectConnection();
    document.removeEventListener('keydown', this.docKeyDown);
    document.removeEventListener('keyup', this.docKeyUp);
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.unload();
  }

  // ── Viewport ───────────────────────────────────────────────────

  private applyViewport(): void {
    this.inner.style.transform = viewportTransform(this.vp);
    const size = DOT_SPACING * this.vp.zoom;
    const posX = ((this.vp.x % size) + size) % size;
    const posY = ((this.vp.y % size) + size) % size;
    this.outer.style.backgroundSize = `${size}px ${size}px`;
    this.outer.style.backgroundPosition = `${posX}px ${posY}px`;
    this.zoomPill?.setText(`${Math.round(this.vp.zoom * 100)}%`);
  }

  // ── Canvas event binding ───────────────────────────────────────

  private bindCanvasEvents(): void {
    this.outer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.outer.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        this.vp = applyWheelZoom(e, this.vp, rect);
      } else {
        this.vp = { ...this.vp, x: this.vp.x - e.deltaX, y: this.vp.y - e.deltaY };
      }
      this.applyViewport(); this.scheduleSave();
    }, { passive: false });

    this.outer.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const rect = this.outer.getBoundingClientRect();
        const t1 = e.touches[0]; const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = ((t1.clientX + t2.clientX) / 2) - rect.left;
        const midY = ((t1.clientY + t2.clientY) / 2) - rect.top;
        if (this.pinchDist !== null) {
          const factor = dist / this.pinchDist;
          this.vp = applyPinchZoom(midX, midY, clampZoom(this.vp.zoom * factor), this.vp);
          this.vp.x += midX - this.pinchMidX; this.vp.y += midY - this.pinchMidY;
          this.applyViewport();
        }
        this.pinchDist = dist; this.pinchMidX = midX; this.pinchMidY = midY;
      }
    }, { passive: false });

    this.outer.addEventListener('touchend', () => { this.pinchDist = null; this.scheduleSave(); });
    this.outer.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.docKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement === this.outer) {
        e.preventDefault(); this.spaceDown = true;
        if (!this.isPanning) this.outer.style.cursor = 'grab';
      }
    };
    this.docKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        if (!this.isPanning) this.outer.style.cursor = '';
      }
    };
    document.addEventListener('keydown', this.docKeyDown);
    document.addEventListener('keyup', this.docKeyUp);

    this.outer.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      const isBackground = target === this.outer || target === this.inner;
      if (!isBackground) return;
      this.closeFab();
      if (this.connectMode) {
        if (this.connectSourceId) {
          this.cardEls.get(this.connectSourceId)?.removeClass('is-connect-source');
          this.connectSourceId = null;
          this.stopConnectSourceGhost();
        }
        return;
      }
      if (this.selectedConnectionId) this.deselectConnection();
      if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
        e.preventDefault(); this.startPan(e);
      } else if (e.button === 0) {
        if (!e.shiftKey) { this.selection.clear(); this.refreshSelectionVisuals(); }
        this.startMarquee(e);
      }
    });

    // Canvas right-click
    this.outer.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (target !== this.outer && target !== this.inner) return;
      e.preventDefault();
      const rect = this.outer.getBoundingClientRect();
      const cp = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, this.vp);
      const menu = new Menu();
      menu.addItem(i => i.setTitle('Add tile').setIcon('layout-grid').onClick(() =>
        this.addTileAt(snap(cp.x - TILE_DEFAULT_W / 2), snap(cp.y - TILE_DEFAULT_H / 2))));
      menu.addItem(i => i.setTitle('Add sticky').setIcon('sticky-note').onClick(() =>
        this.addStickyAt(snap(cp.x - STICKY_DEFAULT_W / 2), snap(cp.y - STICKY_DEFAULT_H / 2))));
      menu.addItem(i => i.setTitle('Add checklist').setIcon('check-square').onClick(() =>
        this.addChecklistAt(snap(cp.x - CHECKLIST_DEFAULT_W / 2), snap(cp.y - CHECKLIST_DEFAULT_H / 2))));
      menu.addItem(i => i.setTitle('Add note link').setIcon('file-text').onClick(() =>
        this.addNoteLinkAt(snap(cp.x - NOTELINK_DEFAULT_W / 2), snap(cp.y - NOTELINK_DEFAULT_H / 2))));
      menu.addItem(i => i.setTitle('Add image').setIcon('image').onClick(() =>
        this.addImageAt(snap(cp.x - IMAGE_DEFAULT_W / 2), snap(cp.y - IMAGE_DEFAULT_H / 2))));
      menu.addItem(i => i.setTitle('Add bookmark').setIcon('bookmark').onClick(() =>
        this.addBookmarkAt(snap(cp.x - BOOKMARK_DEFAULT_W / 2), snap(cp.y - BOOKMARK_DEFAULT_H / 2))));
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Reset view').setIcon('maximize').onClick(() => {
        this.vp = { x: 0, y: 0, zoom: 1 }; this.applyViewport(); this.scheduleSave();
      }));
      menu.showAtMouseEvent(e);
    });

    // Clipboard paste
    this.outer.addEventListener('paste', async (e) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        || (active instanceof HTMLElement && active.getAttribute('contenteditable'))) return;
      e.preventDefault();
      const data = e.clipboardData; if (!data) return;
      // Image?
      for (const item of Array.from(data.items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile(); if (f) { await this.handlePastedImage(f); return; }
        }
      }
      // Text?
      const text = data.getData('text/plain').trim(); if (!text) return;
      if (isValidURL(text)) {
        const { x, y } = this.centerPos(BOOKMARK_DEFAULT_W, BOOKMARK_DEFAULT_H);
        this.createBookmarkCard(x, y, text);
      } else {
        const { x, y } = this.centerPos(STICKY_DEFAULT_W, STICKY_DEFAULT_H);
        this.addStickyAt(x, y, text);
      }
    });

    // Drag-and-drop from Finder or vault sidebar
    this.outer.addEventListener('dragover', (e) => {
      if (this.isImageDrag(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }
    });
    this.outer.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files?.length) {
        const rect = this.outer.getBoundingClientRect();
        let offsetX = 0;
        for (const f of Array.from(files)) {
          if (!f.type.startsWith('image/')) continue;
          const cp = screenToCanvas(e.clientX - rect.left + offsetX, e.clientY - rect.top, this.vp);
          await this.handleDroppedImage(f, snap(cp.x - IMAGE_DEFAULT_W / 2), snap(cp.y - IMAGE_DEFAULT_H / 2));
          offsetX += IMAGE_DEFAULT_W + 16;
        }
        return;
      }
      // Vault sidebar file drag
      const draggable = (this.app as any).dragManager?.draggable;
      if (draggable?.type === 'file' && draggable.file) {
        const vf = draggable.file as TFile;
        if (IMAGE_EXTS.includes(vf.extension.toLowerCase())) {
          const rect = this.outer.getBoundingClientRect();
          const cp = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, this.vp);
          const card: ImageCard = {
            id: crypto.randomUUID(), kind: 'image',
            x: snap(cp.x - IMAGE_DEFAULT_W / 2), y: snap(cp.y - IMAGE_DEFAULT_H / 2),
            w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, z: this.nextZ(),
            source: { type: 'vault', path: vf.path },
          };
          this.pushUndo(); this.board.cards.push(card); await this.saveNow();
          this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
        }
      }
    });
  }

  // ── Pan ────────────────────────────────────────────────────────

  private startPan(e: PointerEvent): void {
    this.isPanning = true; this.outer.style.cursor = 'grabbing';
    const sx = e.clientX, sy = e.clientY, svx = this.vp.x, svy = this.vp.y;
    this.outer.setPointerCapture(e.pointerId);
    const onMove = (e: PointerEvent) => {
      this.vp = { ...this.vp, x: svx + (e.clientX - sx), y: svy + (e.clientY - sy) };
      this.applyViewport();
    };
    const onUp = () => {
      this.outer.removeEventListener('pointermove', onMove); this.outer.removeEventListener('pointerup', onUp);
      this.isPanning = false; this.outer.style.cursor = this.spaceDown ? 'grab' : ''; this.scheduleSave();
    };
    this.outer.addEventListener('pointermove', onMove); this.outer.addEventListener('pointerup', onUp);
  }

  // ── Marquee ────────────────────────────────────────────────────

  private startMarquee(e: PointerEvent): void {
    const rect = this.outer.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    this.marqueeEl.style.cssText = `display:block;left:${sx}px;top:${sy}px;width:0;height:0;`;
    this.outer.setPointerCapture(e.pointerId);
    const onMove = (e: PointerEvent) => {
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      this.marqueeEl.style.left   = `${Math.min(sx, cx)}px`;
      this.marqueeEl.style.top    = `${Math.min(sy, cy)}px`;
      this.marqueeEl.style.width  = `${Math.abs(cx - sx)}px`;
      this.marqueeEl.style.height = `${Math.abs(cy - sy)}px`;
    };
    const onUp = (e: PointerEvent) => {
      this.outer.removeEventListener('pointermove', onMove); this.outer.removeEventListener('pointerup', onUp);
      this.marqueeEl.style.display = 'none';
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const mL = Math.min(sx, cx), mT = Math.min(sy, cy), mR = Math.max(sx, cx), mB = Math.max(sy, cy);
      if (mR - mL < 4 && mB - mT < 4) return;
      for (const [id, el] of this.cardEls) {
        const er = el.getBoundingClientRect();
        const eL = er.left - rect.left, eT = er.top - rect.top;
        if (eL < mR && eL + er.width > mL && eT < mB && eT + er.height > mT) this.selection.add(id);
      }
      this.refreshSelectionVisuals();
    };
    this.outer.addEventListener('pointermove', onMove); this.outer.addEventListener('pointerup', onUp);
  }

  // ── Card creation ──────────────────────────────────────────────

  private createCardEl(card: SupportedCard): HTMLElement {
    const el = this.inner.createDiv('icon-board-freeform-card');
    el.dataset.id = card.id;
    this.positionCardEl(el, card);
    this.renderCardContent(el, card);
    this.bindCardEvents(el, card);
    this.cardEls.set(card.id, el);
    return el;
  }

  private positionCardEl(el: HTMLElement, card: Card): void {
    el.style.left   = `${card.x ?? 0}px`;
    el.style.top    = `${card.y ?? 0}px`;
    el.style.width  = `${card.w ?? TILE_DEFAULT_W}px`;
    el.style.height = `${card.h ?? TILE_DEFAULT_H}px`;
    el.style.zIndex = String(card.z ?? 0);
  }

  // ── Content dispatch ───────────────────────────────────────────

  private renderCardContent(el: HTMLElement, card: SupportedCard): void {
    el.empty();
    el.removeClass(
      'icon-board-freeform-tile-card', 'icon-board-freeform-sticky-card',
      'icon-board-freeform-checklist-card', 'icon-board-freeform-notelink-card',
      'icon-board-freeform-image-card', 'icon-board-freeform-bookmark-card'
    );
    switch (card.kind) {
      case 'tile':      this.renderTileContent(el, card);      break;
      case 'sticky':    this.renderStickyContent(el, card);    break;
      case 'checklist': this.renderChecklistContent(el, card); break;
      case 'note-link': this.renderNoteLinkContent(el, card);  break;
      case 'image':     this.renderImageContent(el, card);     break;
      case 'bookmark':  this.renderBookmarkContent(el, card);  break;
      case 'kanban-column': this.renderKanbanColumnContent(el, card); break;
    }
    el.toggleClass('is-selected', this.selection.has(card.id));
    this.addConnectionHandles(el, card);
  }

  // ── Tile ───────────────────────────────────────────────────────

  private renderTileContent(el: HTMLElement, tile: TileCard): void {
    el.addClass('icon-board-freeform-tile-card');
    const w = parseFloat(el.style.width) || (tile.w ?? TILE_DEFAULT_W);
    const h = parseFloat(el.style.height) || (tile.h ?? TILE_DEFAULT_H);
    const tileSize = Math.max(40, Math.min(w - 20, h - 50 - 16));
    const radius = Math.round(tileSize * 0.2);

    const square = el.createDiv('icon-board-freeform-tile-square');
    square.style.backgroundColor = tile.color;
    square.style.width = `${tileSize}px`; square.style.height = `${tileSize}px`;
    square.style.borderRadius = `${radius}px`;

    const iconColor = contrastColor(tile.color);
    const iconEl = square.createDiv('icon-board-tile-icon');
    iconEl.style.color = iconColor;
    const iconSize = Math.round(tileSize * 0.55);
    iconEl.style.width = `${iconSize}px`; iconEl.style.height = `${iconSize}px`;

    const isSingleEmoji = [...tile.icon].length === 1 && /\p{Emoji_Presentation}/u.test(tile.icon);
    if (isSingleEmoji) {
      iconEl.setText(tile.icon); iconEl.addClass('icon-board-tile-emoji');
      iconEl.style.fontSize = `${Math.round(iconSize * 0.9)}px`;
    } else { setIcon(iconEl, tile.icon); }

    if (tile.target.kind === 'board') {
      const chevron = square.createDiv('icon-board-tile-board-indicator');
      setIcon(chevron, 'chevron-right'); chevron.style.color = iconColor;
    }

    if (tile.target.kind === 'kanban') {
      const indicator = square.createDiv('icon-board-tile-board-indicator');
      setIcon(indicator, 'columns-3'); indicator.style.color = iconColor;
    }

    el.createDiv({ cls: 'icon-board-tile-label', text: tile.label });
    if (tile.subtitle) el.createDiv({ cls: 'icon-board-tile-subtitle', text: tile.subtitle });
    el.createDiv('icon-board-card-resize-handle');
  }

  // ── Sticky ─────────────────────────────────────────────────────

  private renderStickyContent(el: HTMLElement, card: StickyCard): void {
    el.addClass('icon-board-freeform-sticky-card');
    el.style.backgroundColor = card.color;
    const textEl = el.createDiv('icon-board-sticky-text');
    MarkdownRenderer.render(this.app, card.text || '*Double-click to edit…*', textEl, '', this);
    el.createDiv('icon-board-card-resize-handle');
  }

  private editStickyInline(el: HTMLElement, card: StickyCard): void {
    const textEl = el.querySelector('.icon-board-sticky-text') as HTMLElement | null;
    if (!textEl || el.querySelector('.icon-board-sticky-editor')) return;
    const textarea = el.createEl('textarea', { cls: 'icon-board-sticky-editor' });
    textarea.value = card.text;
    textEl.style.display = 'none';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const commit = () => {
      if (!el.contains(textarea)) return;
      this.pushUndo(); card.text = textarea.value;
      textarea.remove(); textEl.style.display = '';
      textEl.empty();
      MarkdownRenderer.render(this.app, card.text || '*Double-click to edit…*', textEl, '', this);
      this.scheduleSave();
    };
    textarea.addEventListener('blur', commit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); textarea.removeEventListener('blur', commit);
        textarea.remove(); textEl.style.display = '';
      }
    });
  }

  // ── Checklist ──────────────────────────────────────────────────

  private renderChecklistContent(el: HTMLElement, card: ChecklistCard): void {
    el.addClass('icon-board-freeform-checklist-card');
    el.style.backgroundColor = card.color;

    const titleEl = el.createEl('input', { cls: 'icon-board-checklist-title' }) as HTMLInputElement;
    titleEl.type = 'text'; titleEl.value = card.title || ''; titleEl.placeholder = 'Checklist';
    titleEl.addEventListener('input', () => { card.title = titleEl.value; });
    titleEl.addEventListener('blur', () => this.scheduleSave());

    const listEl = el.createDiv('icon-board-checklist-list');
    for (const item of card.items) this.appendChecklistItem(listEl, card, item);

    const addEl = el.createDiv({ cls: 'icon-board-checklist-add', text: '+ Add item' });
    addEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    addEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newItem = { id: crypto.randomUUID(), text: '', done: false };
      this.pushUndo(); card.items.push(newItem);
      const row = this.appendChecklistItem(listEl, card, newItem);
      setTimeout(() => (row.querySelector('.icon-board-checklist-item-input') as HTMLElement | null)?.focus(), 0);
    });

    el.createDiv('icon-board-card-resize-handle');
  }

  private appendChecklistItem(
    listEl: HTMLElement, card: ChecklistCard,
    item: { id: string; text: string; done: boolean }
  ): HTMLElement {
    const row = listEl.createDiv('icon-board-checklist-item');
    if (item.done) row.addClass('is-done');

    const cb = row.createEl('input') as HTMLInputElement;
    cb.type = 'checkbox'; cb.checked = item.done; cb.className = 'icon-board-checklist-cb';
    cb.addEventListener('change', () => { item.done = cb.checked; row.toggleClass('is-done', item.done); this.scheduleSave(); });

    const input = row.createEl('input') as HTMLInputElement;
    input.type = 'text'; input.value = item.text; input.placeholder = 'Item…';
    input.className = 'icon-board-checklist-item-input';
    input.addEventListener('input', () => { item.text = input.value; });
    input.addEventListener('blur', () => this.scheduleSave());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = card.items.indexOf(item);
        const ni = { id: crypto.randomUUID(), text: '', done: false };
        card.items.splice(idx + 1, 0, ni);
        const nr = this.appendChecklistItem(listEl, card, ni);
        row.after(nr);
        (nr.querySelector('.icon-board-checklist-item-input') as HTMLElement | null)?.focus();
      }
      if (e.key === 'Backspace' && input.value === '') {
        const idx = card.items.indexOf(item);
        if (idx > 0) {
          e.preventDefault(); card.items.splice(idx, 1);
          const prev = row.previousElementSibling as HTMLElement | null;
          row.remove();
          (prev?.querySelector('.icon-board-checklist-item-input') as HTMLElement | null)?.focus();
          this.scheduleSave();
        }
      }
    });
    return row;
  }

  // ── NoteLink ───────────────────────────────────────────────────

  private renderNoteLinkContent(el: HTMLElement, card: NoteLinkCard): void {
    el.addClass('icon-board-freeform-notelink-card');

    const titleBar = el.createDiv('icon-board-notelink-titlebar');
    setIcon(titleBar.createDiv('icon-board-notelink-icon'), 'file-text');

    const file = this.app.vault.getAbstractFileByPath(card.path);
    const title = file ? file.name.replace(/\.md$/, '') : (card.path || 'Note Link');
    titleBar.createDiv({ cls: 'icon-board-notelink-title', text: title });

    const modeBtn = titleBar.createEl('button', { cls: 'icon-board-notelink-mode-btn' });
    modeBtn.setAttribute('title', card.displayMode === 'preview' ? 'Switch to title-only' : 'Switch to preview');
    setIcon(modeBtn, card.displayMode === 'preview' ? 'minimize-2' : 'eye');
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault(); this.pushUndo();
      card.displayMode = card.displayMode === 'preview' ? 'title-only' : 'preview';
      if (card.displayMode === 'preview') {
        card.w = Math.max(card.w ?? NOTELINK_DEFAULT_W, NOTELINK_DEFAULT_W);
        card.h = Math.max(card.h ?? NOTELINK_DEFAULT_H, NOTELINK_DEFAULT_H);
      } else { card.w = card.w ?? NOTELINK_TITLE_W; card.h = NOTELINK_TITLE_H; }
      el.style.width = `${card.w}px`; el.style.height = `${card.h}px`;
      this.renderCardContent(el, card); this.bindCardEvents(el, card); this.scheduleSave();
    });

    if (card.displayMode === 'preview' && file instanceof TFile) {
      const previewEl = el.createDiv('icon-board-notelink-preview');
      const loadPreview = (f: TFile) => {
        if (!el.contains(previewEl)) return;
        this.app.vault.cachedRead(f).then(content => {
          if (!el.contains(previewEl)) return;
          previewEl.empty();
          MarkdownRenderer.render(this.app, content, previewEl, f.path, this);
        });
      };
      loadPreview(file);

      const reloadBtn = titleBar.createEl('button', { cls: 'icon-board-notelink-mode-btn' });
      reloadBtn.setAttribute('title', 'Reload note content'); setIcon(reloadBtn, 'refresh-cw');
      reloadBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); loadPreview(file); });

      this.registerEvent(this.app.vault.on('modify', (modified) => {
        if (modified instanceof TFile && modified.path === card.path) loadPreview(modified);
      }));
    }

    el.createDiv('icon-board-card-resize-handle');
  }

  // ── Image ──────────────────────────────────────────────────────

  private renderImageContent(el: HTMLElement, card: ImageCard): void {
    el.addClass('icon-board-freeform-image-card');

    const wrap = el.createDiv('icon-board-image-wrap');
    const img = wrap.createEl('img', { cls: 'icon-board-image-img' });

    if (card.source.type === 'vault') {
      const vf = this.app.vault.getAbstractFileByPath(card.source.path);
      if (vf instanceof TFile) {
        img.src = this.app.vault.getResourcePath(vf);
      } else {
        wrap.addClass('icon-board-image-missing');
        wrap.createDiv({ cls: 'icon-board-image-missing-label', text: 'Image not found' });
        img.remove();
      }
    } else {
      img.src = card.source.url;
    }

    img.addEventListener('error', () => {
      img.remove(); wrap.addClass('icon-board-image-missing');
      wrap.createDiv({ cls: 'icon-board-image-missing-label', text: 'Failed to load' });
    });

    const captionInput = el.createEl('input', { cls: 'icon-board-image-caption' }) as HTMLInputElement;
    captionInput.type = 'text'; captionInput.value = card.caption || '';
    captionInput.placeholder = 'Add caption…';
    captionInput.addEventListener('pointerdown', (e) => e.stopPropagation());
    captionInput.addEventListener('input', () => { card.caption = captionInput.value; });
    captionInput.addEventListener('blur', () => this.scheduleSave());

    el.createDiv('icon-board-card-resize-handle');
  }

  // ── Bookmark ───────────────────────────────────────────────────

  private renderBookmarkContent(el: HTMLElement, card: BookmarkCard): void {
    el.addClass('icon-board-freeform-bookmark-card');

    if (card.fetchFailed) {
      const fail = el.createDiv('icon-board-bookmark-fail');
      fail.createDiv({ cls: 'icon-board-bookmark-fail-url', text: card.url });
      const retry = fail.createEl('button', { cls: 'icon-board-bookmark-retry', text: 'Retry' });
      retry.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        card.fetchFailed = false;
        this.renderCardContent(el, card); this.bindCardEvents(el, card);
        this.fetchAndUpdateBookmark(card, el);
      });
    } else if (!card.title && !card.fetchedAt) {
      const loading = el.createDiv('icon-board-bookmark-loading');
      const spinnerEl = loading.createDiv('icon-board-bookmark-spinner');
      setIcon(spinnerEl, 'loader');
      loading.createDiv({ cls: 'icon-board-bookmark-loading-text', text: 'Fetching preview…' });
      try { el.createDiv({ cls: 'icon-board-bookmark-domain', text: new URL(card.url).hostname }); } catch {}
    } else {
      if (card.imageUrl) {
        const imgWrap = el.createDiv('icon-board-bookmark-image-wrap');
        const img = imgWrap.createEl('img', { cls: 'icon-board-bookmark-img' });
        img.src = card.imageUrl;
        img.addEventListener('error', () => imgWrap.remove());
      }
      const content = el.createDiv('icon-board-bookmark-content');
      if (card.title) content.createDiv({ cls: 'icon-board-bookmark-title', text: card.title });
      if (card.description) content.createDiv({ cls: 'icon-board-bookmark-desc', text: card.description });

      const footer = el.createDiv('icon-board-bookmark-footer');
      if (card.favicon) {
        const fav = footer.createEl('img', { cls: 'icon-board-bookmark-favicon' });
        fav.src = card.favicon; fav.addEventListener('error', () => fav.remove());
      }
      try { footer.createDiv({ cls: 'icon-board-bookmark-domain', text: new URL(card.url).hostname }); } catch {}
    }

    el.createDiv('icon-board-card-resize-handle');
  }

  // ── Kanban column ──────────────────────────────────────────────

  private renderKanbanColumnContent(el: HTMLElement, card: KanbanColumnCard): void {
    el.addClass('icon-board-freeform-kanban-card');

    const header = el.createDiv('icon-board-kanban-header');
    header.style.borderTopColor = card.color;
    header.style.backgroundColor = `${card.color}26`;

    const titleEl = header.createDiv('icon-board-kanban-title');
    if (card.title) {
      titleEl.setText(card.title);
    } else {
      titleEl.addClass('icon-board-kanban-title-empty');
      titleEl.setText('Untitled');
    }
    header.createSpan({ cls: 'icon-board-kanban-col-count' });
    this.updateKanbanCount(card, el);

    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.editKanbanTitle(card, el, titleEl);
    });

    const itemsEl = el.createDiv('icon-board-kanban-items');
    for (const item of card.items) {
      this.appendKanbanItem(itemsEl, card, item);
    }

    itemsEl.addEventListener('dragenter', (e) => {
      if (this.isImageDrag(e)) { e.preventDefault(); itemsEl.addClass('is-drag-over'); }
    });
    itemsEl.addEventListener('dragleave', (e) => {
      if (!itemsEl.contains(e.relatedTarget as Node)) itemsEl.removeClass('is-drag-over');
    });
    itemsEl.addEventListener('dragover', (e) => {
      if (this.isImageDrag(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer!.dropEffect = 'copy'; }
    });
    itemsEl.addEventListener('drop', async (e) => {
      itemsEl.removeClass('is-drag-over');
      if (!this.isImageDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files?.length) {
        for (const f of Array.from(files)) {
          if (f.type.startsWith('image/')) await this.handleDroppedImageToKanban(f, card, itemsEl);
        }
        return;
      }
      const draggable = (this.app as any).dragManager?.draggable;
      if (draggable?.type === 'file' && draggable.file) {
        const vf = draggable.file as TFile;
        if (IMAGE_EXTS.includes(vf.extension.toLowerCase())) this.addKanbanImageItem(vf.path, card, itemsEl);
      }
    });

    const addBtn = el.createDiv('icon-board-kanban-add-btn');
    const addIcon = addBtn.createSpan();
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add item' });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addKanbanItem(card, el);
    });

    el.createDiv('icon-board-card-resize-handle');
  }

  private addKanban(): void {
    const p = this.centerPos(KANBAN_DEFAULT_W, KANBAN_DEFAULT_H);
    this.addKanbanAt(p.x, p.y);
  }

  private addKanbanAt(x: number, y: number): void {
    const card: KanbanColumnCard = {
      id: crypto.randomUUID(), kind: 'kanban-column',
      x, y, w: KANBAN_DEFAULT_W, h: KANBAN_DEFAULT_H, z: this.nextZ(),
      color: '#6b7280',
      items: [],
    };
    this.pushUndo(); this.board.cards.push(card); this.saveNow();
    this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
  }

  private rebuildKanbanCard(card: KanbanColumnCard): void {
    const oldEl = this.cardEls.get(card.id);
    if (!oldEl) return;
    const newEl = this.inner.createDiv('icon-board-freeform-card');
    newEl.dataset.id = card.id;
    this.positionCardEl(newEl, card);
    this.renderCardContent(newEl, card);
    this.bindCardEvents(newEl, card);
    oldEl.replaceWith(newEl);
    this.cardEls.set(card.id, newEl);
  }

  private updateKanbanCount(card: KanbanColumnCard, cardEl: HTMLElement): void {
    const countSpan = cardEl.querySelector<HTMLElement>('.icon-board-kanban-col-count');
    const wipDot = cardEl.querySelector<HTMLElement>('.icon-board-kanban-wip-dot');
    const overWip = card.wipLimit !== undefined && card.items.length > card.wipLimit;
    if (countSpan) {
      countSpan.setText(
        card.wipLimit !== undefined ? `${card.items.length}/${card.wipLimit}` : String(card.items.length)
      );
    }
    if (overWip && !wipDot) {
      cardEl.querySelector('.icon-board-kanban-header')?.createSpan({ cls: 'icon-board-kanban-wip-dot' });
    } else if (!overWip && wipDot) {
      wipDot.remove();
    }
  }

  private editKanbanTitle(card: KanbanColumnCard, _cardEl: HTMLElement, titleEl: HTMLElement): void {
    if (titleEl.querySelector('input')) return;
    const original = card.title ?? '';
    titleEl.empty();
    const input = titleEl.createEl('input');
    input.type = 'text';
    input.value = original;
    input.addClass('icon-board-kanban-title-input');

    let cancelled = false;
    const commit = () => {
      if (cancelled) {
        titleEl.empty();
        if (original) {
          titleEl.setText(original);
        } else {
          titleEl.addClass('icon-board-kanban-title-empty');
          titleEl.setText('Untitled');
        }
        return;
      }
      const val = input.value.trim();
      this.pushUndo();
      card.title = val || undefined;
      titleEl.empty();
      if (card.title) {
        titleEl.removeClass('icon-board-kanban-title-empty');
        titleEl.setText(card.title);
      } else {
        titleEl.addClass('icon-board-kanban-title-empty');
        titleEl.setText('Untitled');
      }
      this.scheduleSave();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; input.blur(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  private appendKanbanItem(itemsEl: HTMLElement, card: KanbanColumnCard, item: KanbanItem): void {
    const itemEl = itemsEl.createDiv('icon-board-kanban-item');
    itemEl.dataset.itemId = item.id;
    itemEl.toggleClass('is-done', item.done ?? false);
    itemEl.setAttribute('tabindex', '0');

    const cb = itemEl.createDiv('icon-board-kanban-item-cb');
    cb.toggleClass('is-checked', item.done ?? false);
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushUndo();
      item.done = !item.done;
      itemEl.toggleClass('is-done', item.done);
      cb.toggleClass('is-checked', item.done);
      const cardEl = this.cardEls.get(card.id);
      if (cardEl) this.updateKanbanCount(card, cardEl);
      this.scheduleSave();
    });

    const bodyEl = itemEl.createDiv('icon-board-kanban-item-body');
    const textEl = bodyEl.createDiv('icon-board-kanban-item-text');
    if (item.text) {
      MarkdownRenderer.render(this.app, item.text, textEl, '', this).catch(() => textEl.setText(item.text));
    }
    if (item.imagePath) {
      const imgWrap = bodyEl.createDiv('icon-board-kanban-item-image');
      const vf = this.app.vault.getAbstractFileByPath(item.imagePath);
      if (vf instanceof TFile) {
        const img = imgWrap.createEl('img');
        img.src = this.app.vault.getResourcePath(vf);
        img.alt = '';
      }
    }

    const hasMeta = item.linkedNotePath || (item.tags && item.tags.length > 0);
    if (hasMeta) {
      const metaEl = bodyEl.createDiv('icon-board-kanban-item-meta');
      if (item.linkedNotePath) {
        const pill = metaEl.createDiv('icon-board-kanban-item-note-pill');
        const iconEl = pill.createSpan(); setIcon(iconEl, 'file-text');
        const noteName = item.linkedNotePath.split('/').pop()?.replace(/\.md$/, '') ?? item.linkedNotePath;
        pill.createSpan({ text: noteName });
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.workspace.openLinkText(item.linkedNotePath!, '', false);
        });
      }
      if (item.tags) {
        for (const tag of item.tags) {
          metaEl.createDiv({ cls: 'icon-board-kanban-item-tag', text: `#${tag}` });
        }
      }
    }

    const delBtn = itemEl.createDiv('icon-board-kanban-item-del');
    setIcon(delBtn, 'x');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushUndo();
      card.items = card.items.filter(i => i.id !== item.id);
      itemEl.remove();
      const cardEl = this.cardEls.get(card.id);
      if (cardEl) this.updateKanbanCount(card, cardEl);
      this.scheduleSave();
    });

    itemEl.addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); cb.click(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.editKanbanItemInline(card, item, itemEl); }
    });

    itemEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.icon-board-kanban-item-cb') || target.closest('.icon-board-kanban-item-del')) return;
      e.stopPropagation();

      let wasDragged = false;
      const sx = e.clientX, sy = e.clientY;
      const startE = e;

      const onMove = (e2: PointerEvent) => {
        if (!wasDragged && Math.hypot(e2.clientX - sx, e2.clientY - sy) > DRAG_THRESHOLD) {
          wasDragged = true;
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          this.startItemDrag(startE, card, item, itemEl, itemsEl);
        }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!wasDragged) this.editKanbanItemInline(card, item, itemEl);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    itemEl.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const menu = new Menu();
      if (item.linkedNotePath) {
        menu.addItem(i => i.setTitle('Open linked note').setIcon('file-text').onClick(() => {
          this.app.workspace.openLinkText(item.linkedNotePath!, '', false);
        }));
        menu.addItem(i => i.setTitle('Remove link').setIcon('unlink').onClick(() => {
          this.pushUndo(); item.linkedNotePath = undefined;
          this.rebuildKanbanCard(card); this.scheduleSave();
        }));
        menu.addSeparator();
      }
      menu.addItem(i => i.setTitle('Link to note…').setIcon('file-text').onClick(() => {
        new NoteLinkPickerModal(this.app, (file) => {
          this.pushUndo(); item.linkedNotePath = file.path;
          this.rebuildKanbanCard(card); this.scheduleSave();
        }).open();
      }));
      if (item.tags && item.tags.length > 0) {
        menu.addSeparator();
        for (const tag of item.tags) {
          menu.addItem(i => i.setTitle(`Remove #${tag}`).setIcon('x').onClick(() => {
            this.pushUndo(); item.tags = item.tags!.filter(t => t !== tag);
            this.rebuildKanbanCard(card); this.scheduleSave();
          }));
        }
      }
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Add tag…').setIcon('tag').onClick(() => this.promptItemTag(card, item)));
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Delete item').setIcon('trash').onClick(() => {
        this.pushUndo();
        card.items = card.items.filter(it => it.id !== item.id);
        itemEl.remove();
        const cardEl = this.cardEls.get(card.id);
        if (cardEl) this.updateKanbanCount(card, cardEl);
        this.scheduleSave();
      }));
      menu.showAtMouseEvent(e);
    });
  }

  private editKanbanItemInline(card: KanbanColumnCard, item: KanbanItem, itemEl: HTMLElement): void {
    if (itemEl.querySelector('.icon-board-kanban-item-editor')) return;
    const textEl = itemEl.querySelector<HTMLElement>('.icon-board-kanban-item-text');
    if (!textEl) return;

    const original = item.text;
    itemEl.addClass('is-editing');
    textEl.empty();

    const ta = textEl.createEl('textarea', { cls: 'icon-board-kanban-item-editor' });
    ta.value = original;

    const autosize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

    let cancelled = false;
    const commit = () => {
      itemEl.removeClass('is-editing');
      if (cancelled) {
        textEl.empty();
        if (original) {
          MarkdownRenderer.render(this.app, original, textEl, '', this).catch(() => textEl.setText(original));
        } else {
          card.items = card.items.filter(i => i.id !== item.id);
          itemEl.remove();
          const cardEl = this.cardEls.get(card.id);
          if (cardEl) this.updateKanbanCount(card, cardEl);
        }
        return;
      }
      const val = ta.value.trim();
      this.pushUndo();
      if (!val) {
        card.items = card.items.filter(i => i.id !== item.id);
        itemEl.remove();
        const cardEl = this.cardEls.get(card.id);
        if (cardEl) this.updateKanbanCount(card, cardEl);
        this.scheduleSave();
        return;
      }
      item.text = val;
      textEl.empty();
      MarkdownRenderer.render(this.app, val, textEl, '', this).catch(() => textEl.setText(val));
      this.scheduleSave();
    };

    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; ta.blur(); }
      e.stopPropagation();
    });
    ta.addEventListener('blur', commit);
    requestAnimationFrame(() => {
      ta.focus();
      autosize();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  private addKanbanItem(card: KanbanColumnCard, cardEl: HTMLElement): void {
    const itemsEl = cardEl.querySelector<HTMLElement>('.icon-board-kanban-items');
    if (!itemsEl) return;
    this.pushUndo();
    const item: KanbanItem = { id: crypto.randomUUID(), text: '', done: false };
    card.items.push(item);
    this.updateKanbanCount(card, cardEl);
    this.appendKanbanItem(itemsEl, card, item);
    const newItemEl = itemsEl.lastElementChild as HTMLElement | null;
    if (newItemEl) {
      newItemEl.scrollIntoView({ block: 'nearest' });
      this.editKanbanItemInline(card, item, newItemEl);
    }
  }

  private promptItemTag(card: KanbanColumnCard, item: KanbanItem): void {
    new TagInputModal(this.app, (tag) => {
      this.pushUndo();
      item.tags = [...(item.tags ?? []), tag];
      this.rebuildKanbanCard(card);
      this.scheduleSave();
    }).open();
  }

  private startItemDrag(
    startEvent: PointerEvent,
    sourceCard: KanbanColumnCard,
    item: KanbanItem,
    itemEl: HTMLElement,
    _sourceItemsEl: HTMLElement
  ): void {
    const itemRect = itemEl.getBoundingClientRect();

    const ghost = document.createElement('div');
    ghost.className = 'icon-board-kanban-drag-ghost';
    ghost.textContent = item.text || '…';
    ghost.style.width = `${itemRect.width}px`;
    ghost.style.left = `${itemRect.left}px`;
    ghost.style.top = `${itemRect.top}px`;
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);

    itemEl.addClass('is-dragging');

    let dropIndicator: HTMLElement | null = null;
    let targetCard: KanbanColumnCard | null = null;
    let insertBeforeItemId: string | null = null;

    const removeIndicator = () => { dropIndicator?.remove(); dropIndicator = null; };

    const onMove = (e: PointerEvent) => {
      ghost.style.left = `${itemRect.left + (e.clientX - startEvent.clientX)}px`;
      ghost.style.top = `${itemRect.top + (e.clientY - startEvent.clientY)}px`;
      removeIndicator();
      targetCard = null;
      insertBeforeItemId = null;

      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let foundCardEl: HTMLElement | null = null;
      let foundCard: KanbanColumnCard | null = null;
      for (const el of els) {
        const ce = (el as HTMLElement).closest<HTMLElement>('[data-id]');
        if (!ce) continue;
        const cid = ce.dataset.id;
        const c = this.board.cards.find(c => c.id === cid && c.kind === 'kanban-column') as KanbanColumnCard | undefined;
        if (c) { foundCard = c; foundCardEl = ce; break; }
      }
      if (!foundCard || !foundCardEl) return;
      targetCard = foundCard;

      const tItemsEl = foundCardEl.querySelector<HTMLElement>('.icon-board-kanban-items');
      if (!tItemsEl) return;

      const visItems = Array.from(tItemsEl.querySelectorAll<HTMLElement>('.icon-board-kanban-item:not(.is-dragging)'));
      dropIndicator = document.createElement('div');
      dropIndicator.className = 'icon-board-kanban-drop-indicator';

      let placed = false;
      for (const vi of visItems) {
        const vr = vi.getBoundingClientRect();
        if (e.clientY < vr.top + vr.height / 2) {
          insertBeforeItemId = vi.dataset.itemId ?? null;
          tItemsEl.insertBefore(dropIndicator, vi);
          placed = true;
          break;
        }
      }
      if (!placed) {
        insertBeforeItemId = null;
        tItemsEl.appendChild(dropIndicator);
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      ghost.remove();
      removeIndicator();
      itemEl.removeClass('is-dragging');

      if (!targetCard) return;
      this.pushUndo();

      sourceCard.items = sourceCard.items.filter(i => i.id !== item.id);

      const insertIdx = insertBeforeItemId
        ? targetCard.items.findIndex(i => i.id === insertBeforeItemId)
        : -1;

      if (insertIdx !== -1) {
        targetCard.items.splice(insertIdx, 0, item);
      } else {
        targetCard.items.push(item);
      }

      if (targetCard === sourceCard) {
        this.rebuildKanbanCard(sourceCard);
      } else {
        this.rebuildKanbanCard(sourceCard);
        this.rebuildKanbanCard(targetCard);
      }
      this.scheduleSave();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private async fetchAndUpdateBookmark(card: BookmarkCard, el: HTMLElement): Promise<void> {
    try {
      const resp = await requestUrl({ url: card.url });
      const doc = new DOMParser().parseFromString(resp.text, 'text/html');
      const getMeta = (sel: string) => doc.querySelector(sel)?.getAttribute('content') ?? undefined;

      card.title = getMeta('meta[property="og:title"]') || getMeta('meta[name="twitter:title"]') || doc.title || undefined;
      card.description = getMeta('meta[property="og:description"]') || getMeta('meta[name="description"]') || undefined;

      const ogImg = getMeta('meta[property="og:image"]') || getMeta('meta[name="twitter:image"]');
      if (ogImg) { try { card.imageUrl = new URL(ogImg, card.url).href; } catch { card.imageUrl = ogImg; } }

      const origin = new URL(card.url).origin;
      const favEl = doc.querySelector('link[rel~="icon"]') as HTMLLinkElement | null;
      const favHref = favEl?.getAttribute('href');
      if (favHref) { try { card.favicon = new URL(favHref, card.url).href; } catch { card.favicon = `${origin}/favicon.ico`; } }
      else { card.favicon = `${origin}/favicon.ico`; }

      card.fetchedAt = Date.now(); card.fetchFailed = false;
    } catch {
      card.fetchFailed = true; card.fetchedAt = Date.now();
    }

    if (el.isConnected) {
      this.renderCardContent(el, card); this.bindCardEvents(el, card);
      await this.saveNow();
    }
  }

  // ── Selection ──────────────────────────────────────────────────

  private refreshSelectionVisuals(): void {
    for (const [id, el] of this.cardEls) el.toggleClass('is-selected', this.selection.has(id));
  }

  // ── Card events ────────────────────────────────────────────────

  private bindCardEvents(el: HTMLElement, card: SupportedCard): void {
    let dragMoved = false;

    el.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('icon-board-card-resize-handle')) return;
      if (target.classList.contains('icon-board-connection-handle')) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
      if (target.getAttribute('contenteditable')) return;
      if (target.closest('a')) return;
      if (e.button !== 0) return;

      if (this.connectMode) {
        e.stopPropagation(); e.preventDefault();
        if (!this.connectSourceId) {
          this.connectSourceId = card.id;
          el.addClass('is-connect-source');
          this.startConnectSourceGhost(card.id);
        } else if (this.connectSourceId !== card.id) {
          const fromId = this.connectSourceId;
          this.exitConnectMode();
          this.finishConnection(fromId, card.id);
        }
        return;
      }

      // Skip preventDefault on the kanban title so dblclick still fires (drag still works via capture)
      const isKanbanTitle = card.kind === 'kanban-column' && !!target.closest('.icon-board-kanban-title');
      e.stopPropagation();
      if (!isKanbanTitle) e.preventDefault();

      if (this.selectedConnectionId) this.deselectConnection();

      // Kanban column: body area never drags the card — only the header does
      if (card.kind === 'kanban-column' && !target.closest('.icon-board-kanban-header')) {
        if (e.shiftKey) { this.selection.toggle(card.id); this.refreshSelectionVisuals(); }
        else if (!this.selection.has(card.id)) { this.selection.select(card.id); this.refreshSelectionVisuals(); }
        return;
      }

      if (e.shiftKey) { this.selection.toggle(card.id); this.refreshSelectionVisuals(); return; }
      if (!this.selection.has(card.id)) { this.selection.select(card.id); this.refreshSelectionVisuals(); }

      dragMoved = false;
      const sc = { x: e.clientX, y: e.clientY };
      const startPos = new Map<string, { x: number; y: number }>();
      const captureId = e.pointerId;
      for (const id of this.selection.getIds()) {
        const c = this.board.cards.find(c => c.id === id);
        if (c) startPos.set(id, { x: c.x ?? 0, y: c.y ?? 0 });
      }

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - sc.x, dy = e.clientY - sc.y;
        if (!dragMoved) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          dragMoved = true; this.pushUndo();
          el.setPointerCapture(captureId);
        }
        for (const [id, start] of startPos) {
          const c = this.board.cards.find(c => c.id === id); const cel = this.cardEls.get(id);
          if (!c || !cel) continue;
          c.x = snap(start.x + dx / this.vp.zoom); c.y = snap(start.y + dy / this.vp.zoom);
          cel.style.left = `${c.x}px`; cel.style.top = `${c.y}px`;
          this.updateConnectionsForCard(id);
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
        if (dragMoved) this.scheduleSave();
      };
      el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
    });

    el.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      switch (card.kind) {
        case 'tile':      await this.activateTile(card); break;
        case 'sticky':    this.editStickyInline(el, card); break;
        case 'note-link': await this.activateNoteLink(card); break;
        case 'image':     this.openImageSource(card); break;
        case 'bookmark':  window.open(card.url, '_blank'); break;
      }
    });

    this.bindResizeHandle(el, card);

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this.selection.has(card.id)) { this.selection.select(card.id); this.refreshSelectionVisuals(); }
      const menu = new Menu();
      this.populateCardMenu(menu, el, card);
      menu.showAtMouseEvent(e);
    });
  }

  private populateCardMenu(menu: Menu, el: HTMLElement, card: SupportedCard): void {
    if (card.kind === 'tile') {
      menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => {
        new TileModal(this.app, card, async (updated) => {
          const idx = this.board.cards.findIndex(c => c.id === updated.id);
          if (idx !== -1) {
            this.board.cards[idx] = updated; this.cardEls.delete(card.id);
            this.renderCardContent(el, updated as TileCard); this.bindCardEvents(el, updated as TileCard);
            this.cardEls.set(updated.id, el); await this.saveNow();
          }
        }).open();
      }));
    }

    if (card.kind === 'sticky') {
      menu.addItem(i => i.setTitle('Edit text').setIcon('pencil').onClick(() => this.editStickyInline(el, card)));
      menu.addSeparator();
      for (const { color, name } of STICKY_COLORS) {
        menu.addItem(i => i.setTitle(name).onClick(() => {
          this.pushUndo(); card.color = color; el.style.backgroundColor = color; this.scheduleSave();
        }));
      }
    }

    if (card.kind === 'note-link') {
      menu.addItem(i => i.setTitle('Change note…').setIcon('file-text').onClick(() => {
        new NoteLinkPickerModal(this.app, (file) => {
          this.pushUndo(); card.path = file.path;
          this.renderCardContent(el, card); this.bindCardEvents(el, card); this.scheduleSave();
        }).open();
      }));
    }

    if (card.kind === 'image') {
      menu.addItem(i => i.setTitle('Choose from vault…').setIcon('folder-open').onClick(() => {
        new VaultImagePickerModal(this.app, (file) => {
          this.pushUndo(); card.source = { type: 'vault', path: file.path };
          this.renderCardContent(el, card); this.bindCardEvents(el, card); this.scheduleSave();
        }).open();
      }));
    }

    if (card.kind === 'bookmark') {
      menu.addItem(i => i.setTitle('Refresh preview').setIcon('refresh-cw').onClick(() => {
        card.fetchFailed = false; card.fetchedAt = undefined;
        this.renderCardContent(el, card); this.bindCardEvents(el, card);
        this.fetchAndUpdateBookmark(card, el);
      }));
      menu.addItem(i => i.setTitle('Copy URL').setIcon('copy').onClick(() => {
        navigator.clipboard.writeText(card.url); new Notice('URL copied.');
      }));
    }

    if (card.kind === 'kanban-column') {
      const doneCnt = card.items.filter(i => i.done).length;
      for (const { color, name } of KANBAN_COLORS) {
        menu.addItem(i => i
          .setTitle(name)
          .setChecked(card.color.toLowerCase() === color)
          .onClick(() => {
            this.pushUndo();
            card.color = color;
            this.rebuildKanbanCard(card);
            this.scheduleSave();
          }));
      }
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Set WIP limit…').setIcon('hash').onClick(() => {
        new WipLimitModal(this.app, card.wipLimit, (limit) => {
          this.pushUndo();
          card.wipLimit = limit;
          this.rebuildKanbanCard(card);
          this.scheduleSave();
        }).open();
      }));
      if (doneCnt > 0) {
        menu.addItem(i => i
          .setTitle(`Clear ${doneCnt} done item${doneCnt !== 1 ? 's' : ''}`)
          .setIcon('check-check')
          .onClick(() => {
            this.pushUndo();
            card.items = card.items.filter(i => !i.done);
            this.rebuildKanbanCard(card);
            this.scheduleSave();
          }));
      }
      menu.addSeparator();
    }

    menu.addItem(i => i.setTitle('Duplicate').setIcon('copy').onClick(() => this.duplicateSelected()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Bring to front').setIcon('chevrons-up').onClick(() => {
      const maxZ = Math.max(0, ...this.board.cards.map(c => c.z ?? 0));
      let off = 1;
      for (const id of this.selection.getIds()) {
        const c = this.board.cards.find(c => c.id === id);
        const cel = this.cardEls.get(id);
        if (c) { c.z = maxZ + off++; if (cel) cel.style.zIndex = String(c.z); }
      }
      this.scheduleSave();
    }));
    menu.addItem(i => i.setTitle('Send to back').setIcon('chevrons-down').onClick(() => {
      const minZ = Math.min(0, ...this.board.cards.map(c => c.z ?? 0));
      let off = 1;
      for (const id of this.selection.getIds()) {
        const c = this.board.cards.find(c => c.id === id);
        const cel = this.cardEls.get(id);
        if (c) { c.z = minZ - off++; if (cel) cel.style.zIndex = String(c.z); }
      }
      this.scheduleSave();
    }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Delete').setIcon('trash').onClick(() => this.deleteSelected()));
  }

  // ── Resize handle ──────────────────────────────────────────────

  private bindResizeHandle(el: HTMLElement, card: SupportedCard): void {
    const handle = el.querySelector('.icon-board-card-resize-handle') as HTMLElement | null;
    if (!handle) return;

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault(); this.pushUndo();
      const sc = { x: e.clientX, y: e.clientY };
      const startW = card.w ?? TILE_DEFAULT_W, startH = card.h ?? TILE_DEFAULT_H;
      const { w: minW, h: minH } = cardMinSize(card.kind);
      el.setPointerCapture(e.pointerId);

      const onMove = (e: PointerEvent) => {
        card.w = Math.max(minW, snap(startW + (e.clientX - sc.x) / this.vp.zoom));
        card.h = Math.max(minH, snap(startH + (e.clientY - sc.y) / this.vp.zoom));
        el.style.width = `${card.w}px`; el.style.height = `${card.h}px`;
        if (card.kind === 'tile') {
          const tileSize = Math.max(40, Math.min(card.w - 20, card.h - 50 - 16));
          const sq = el.querySelector('.icon-board-freeform-tile-square') as HTMLElement | null;
          const ic = el.querySelector('.icon-board-tile-icon') as HTMLElement | null;
          if (sq) { sq.style.width = `${tileSize}px`; sq.style.height = `${tileSize}px`; sq.style.borderRadius = `${Math.round(tileSize * 0.2)}px`; }
          if (ic) {
            const is = Math.round(tileSize * 0.55);
            ic.style.width = `${is}px`; ic.style.height = `${is}px`;
            if (ic.classList.contains('icon-board-tile-emoji')) ic.style.fontSize = `${Math.round(is * 0.9)}px`;
          }
        }
        this.updateConnectionsForCard(card.id);
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
        this.renderCardContent(el, card); this.bindResizeHandle(el, card);
        this.updateConnectionsForCard(card.id);
        this.scheduleSave();
      };
      el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
    });
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    const active = document.activeElement;
    const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      || (active instanceof HTMLElement && active.getAttribute('contenteditable') != null);
    if (isTyping) return;

    const meta = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (this.connectMode) { this.exitConnectMode(); return; }
      if (this.selectedConnectionId) { this.deselectConnection(); return; }
      this.selection.clear(); this.refreshSelectionVisuals(); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this.selection.isEmpty()) { e.preventDefault(); this.deleteSelected(); return; }
      if (this.selectedConnectionId) { e.preventDefault(); this.deleteSelectedConnection(); return; }
    }
    if (meta && e.key === 'a') { e.preventDefault(); for (const c of this.board.cards) this.selection.add(c.id); this.refreshSelectionVisuals(); return; }
    if (meta && e.key === 'd') { e.preventDefault(); this.duplicateSelected(); return; }
    if (meta && !e.shiftKey && e.key === 'z') { e.preventDefault(); this.undo(); return; }
    if ((meta && e.shiftKey && e.key === 'z') || (meta && e.key === 'y')) { e.preventDefault(); this.redo(); return; }
  }

  // ── Activation ─────────────────────────────────────────────────

  private async activateTile(tile: TileCard): Promise<void> {
    const { target } = tile;
    if (!target.path) { new Notice('This tile has no target set.'); return; }
    if (target.kind === 'board') { await this.onNavigate(target.path); return; }
    const file = this.app.vault.getAbstractFileByPath(target.path);
    if (!file) { new Notice(`Target no longer exists: ${target.path}`); return; }
    if (target.kind === 'note' || target.kind === 'canvas') {
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file as TFile); this.app.workspace.revealLeaf(leaf); return;
    }

    if (target.kind === 'kanban') {
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file as TFile); this.app.workspace.revealLeaf(leaf);
      const isInstalled = (this.app as any).plugins?.enabledPlugins?.has('obsidian-kanban') ?? false;
      if (!isInstalled) new Notice('Install the community "Kanban" plugin to view this as a board.');
      return;
    }
    if (target.kind === 'folder') {
      const folder = file as TFolder;
      const ex = this.app.workspace.getLeavesOfType('file-explorer');
      if (ex.length > 0) { const v = ex[0].view as any; if (typeof v.revealInFolder === 'function') v.revealInFolder(folder); }
      const firstNote = folder.children?.find(f => f instanceof TFile && (f as TFile).extension === 'md') as TFile | undefined;
      if (firstNote) { const leaf = this.app.workspace.getLeaf('tab'); await leaf.openFile(firstNote); this.app.workspace.revealLeaf(leaf); }
    }
  }

  private async activateNoteLink(card: NoteLinkCard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.path);
    if (!(file instanceof TFile)) { new Notice(`Note no longer exists: ${card.path}`); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file); this.app.workspace.revealLeaf(leaf);
  }

  private openImageSource(card: ImageCard): void {
    if (card.source.type === 'vault') {
      const file = this.app.vault.getAbstractFileByPath(card.source.path);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf('tab');
        leaf.openFile(file); this.app.workspace.revealLeaf(leaf);
      }
    } else {
      window.open(card.source.url, '_blank');
    }
  }

  // ── Add cards ──────────────────────────────────────────────────

  private nextZ(): number { return Math.max(0, ...this.board.cards.map(c => c.z ?? 0)) + 1; }

  private centerPos(w: number, h: number): { x: number; y: number } {
    const rect = this.outer.getBoundingClientRect();
    const c = screenToCanvas(rect.width / 2, rect.height / 2, this.vp);
    return { x: snap(c.x - w / 2), y: snap(c.y - h / 2) };
  }

  private addTile(): void { const p = this.centerPos(TILE_DEFAULT_W, TILE_DEFAULT_H); this.addTileAt(p.x, p.y); }
  private addTileAt(x: number, y: number): void {
    new TileModal(this.app, null, async (t) => {
      t.x = x; t.y = y; t.w = TILE_DEFAULT_W; t.h = TILE_DEFAULT_H; t.z = this.nextZ();
      this.pushUndo(); this.board.cards.push(t); await this.saveNow();
      this.createCardEl(t); this.selection.select(t.id); this.refreshSelectionVisuals();
    }).open();
  }

  private addSticky(): void { const p = this.centerPos(STICKY_DEFAULT_W, STICKY_DEFAULT_H); this.addStickyAt(p.x, p.y); }
  private addStickyAt(x: number, y: number, initialText = ''): void {
    const card: StickyCard = { id: crypto.randomUUID(), kind: 'sticky', x, y, w: STICKY_DEFAULT_W, h: STICKY_DEFAULT_H, z: this.nextZ(), text: initialText, color: STICKY_COLORS[0].color };
    this.pushUndo(); this.board.cards.push(card); this.saveNow();
    const el = this.createCardEl(card);
    this.selection.select(card.id); this.refreshSelectionVisuals();
    if (!initialText) this.editStickyInline(el, card);
  }

  private addChecklist(): void { const p = this.centerPos(CHECKLIST_DEFAULT_W, CHECKLIST_DEFAULT_H); this.addChecklistAt(p.x, p.y); }
  private addChecklistAt(x: number, y: number): void {
    const card: ChecklistCard = { id: crypto.randomUUID(), kind: 'checklist', x, y, w: CHECKLIST_DEFAULT_W, h: CHECKLIST_DEFAULT_H, z: this.nextZ(), title: '', items: [], color: 'var(--background-secondary)' };
    this.pushUndo(); this.board.cards.push(card); this.saveNow();
    const el = this.createCardEl(card);
    this.selection.select(card.id); this.refreshSelectionVisuals();
    setTimeout(() => (el.querySelector('.icon-board-checklist-title') as HTMLElement | null)?.focus(), 50);
  }

  private addNoteLink(): void { const p = this.centerPos(NOTELINK_DEFAULT_W, NOTELINK_DEFAULT_H); this.addNoteLinkAt(p.x, p.y); }
  private addNoteLinkAt(x: number, y: number): void {
    new NoteLinkPickerModal(this.app, (file) => {
      const card: NoteLinkCard = { id: crypto.randomUUID(), kind: 'note-link', x, y, w: NOTELINK_DEFAULT_W, h: NOTELINK_DEFAULT_H, z: this.nextZ(), path: file.path, displayMode: 'preview' };
      this.pushUndo(); this.board.cards.push(card); this.saveNow();
      this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
    }).open();
  }

  private addImage(): void { const p = this.centerPos(IMAGE_DEFAULT_W, IMAGE_DEFAULT_H); this.addImageAt(p.x, p.y); }
  private addImageAt(x: number, y: number): void {
    new VaultImagePickerModal(this.app, (file) => {
      const card: ImageCard = { id: crypto.randomUUID(), kind: 'image', x, y, w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, z: this.nextZ(), source: { type: 'vault', path: file.path } };
      this.pushUndo(); this.board.cards.push(card); this.saveNow();
      this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
    }).open();
  }

  private addBookmark(): void { const p = this.centerPos(BOOKMARK_DEFAULT_W, BOOKMARK_DEFAULT_H); this.addBookmarkAt(p.x, p.y); }
  private addBookmarkAt(x: number, y: number, url?: string): void {
    if (url) { this.createBookmarkCard(x, y, url); return; }
    new BookmarkInputModal(this.app, (u) => this.createBookmarkCard(x, y, u)).open();
  }

  private createBookmarkCard(x: number, y: number, url: string): void {
    const card: BookmarkCard = { id: crypto.randomUUID(), kind: 'bookmark', x, y, w: BOOKMARK_DEFAULT_W, h: BOOKMARK_DEFAULT_H, z: this.nextZ(), url };
    this.pushUndo(); this.board.cards.push(card); this.saveNow();
    const el = this.createCardEl(card);
    this.selection.select(card.id); this.refreshSelectionVisuals();
    this.fetchAndUpdateBookmark(card, el);
  }

  // ── Image save helpers ─────────────────────────────────────────

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      try { await this.app.vault.createFolder(path); } catch {}
    }
  }

  private async handlePastedImage(file: File): Promise<void> {
    await this.ensureFolder(this.attachmentFolder);
    const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : 'jpg';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const path = `${this.attachmentFolder}/Pasted Image ${ts}.${ext}`;
    try {
      await this.app.vault.adapter.writeBinary(path, await file.arrayBuffer());
    } catch { new Notice('Failed to save pasted image.'); return; }
    const { x, y } = this.centerPos(IMAGE_DEFAULT_W, IMAGE_DEFAULT_H);
    const card: ImageCard = { id: crypto.randomUUID(), kind: 'image', x, y, w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, z: this.nextZ(), source: { type: 'vault', path } };
    this.pushUndo(); this.board.cards.push(card); await this.saveNow();
    this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
  }

  private async handleDroppedImage(file: File, x: number, y: number): Promise<void> {
    await this.ensureFolder(this.attachmentFolder);
    const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
    const path = `${this.attachmentFolder}/${base}-${Date.now()}.${ext}`;
    try {
      await this.app.vault.adapter.writeBinary(path, await file.arrayBuffer());
    } catch { new Notice(`Failed to save ${file.name}.`); return; }
    const card: ImageCard = { id: crypto.randomUUID(), kind: 'image', x, y, w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, z: this.nextZ(), source: { type: 'vault', path } };
    this.pushUndo(); this.board.cards.push(card); await this.saveNow();
    this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
  }

  private async handleDroppedImageToKanban(file: File, card: KanbanColumnCard, itemsEl: HTMLElement): Promise<void> {
    await this.ensureFolder(this.attachmentFolder);
    const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
    const path = `${this.attachmentFolder}/${base}-${Date.now()}.${ext}`;
    try {
      await this.app.vault.adapter.writeBinary(path, await file.arrayBuffer());
    } catch { new Notice(`Failed to save ${file.name}.`); return; }
    this.addKanbanImageItem(path, card, itemsEl);
  }

  private addKanbanImageItem(imagePath: string, card: KanbanColumnCard, itemsEl: HTMLElement): void {
    this.pushUndo();
    const item: KanbanItem = { id: crypto.randomUUID(), text: '', imagePath };
    card.items.push(item);
    this.appendKanbanItem(itemsEl, card, item);
    const cardEl = this.cardEls.get(card.id);
    if (cardEl) this.updateKanbanCount(card, cardEl);
    this.scheduleSave();
  }

  private isImageDrag(e: DragEvent): boolean {
    if (e.dataTransfer?.types.includes('Files')) return true;
    const draggable = (this.app as any).dragManager?.draggable;
    return draggable?.type === 'file' && IMAGE_EXTS.includes(draggable.file?.extension?.toLowerCase() ?? '');
  }

  // ── Delete & duplicate ─────────────────────────────────────────

  private deleteSelected(): void {
    const ids = this.selection.getIds(); if (!ids.length) return;
    this.pushUndo();
    for (const id of ids) {
      this.board.cards = this.board.cards.filter(c => c.id !== id);
      this.cardEls.get(id)?.remove(); this.cardEls.delete(id);
      // Cascade: remove any connection that references the deleted card
      this.board.connections = this.board.connections.filter(
        c => c.fromCardId !== id && c.toCardId !== id
      );
    }
    this.selection.clear();
    this.refreshAllConnections();
    this.scheduleSave();
  }

  private duplicateSelected(): void {
    const ids = this.selection.getIds(); if (!ids.length) return;
    this.pushUndo();
    const maxZ = Math.max(0, ...this.board.cards.map(c => c.z ?? 0));
    this.selection.clear(); let zOff = 1;
    for (const id of ids) {
      const orig = this.board.cards.find(c => c.id === id); if (!orig) continue;
      const copy = { ...JSON.parse(JSON.stringify(orig)), id: crypto.randomUUID(), x: snap((orig.x ?? 0) + 20), y: snap((orig.y ?? 0) + 20), z: maxZ + zOff++ } as SupportedCard;
      if (copy.kind === 'kanban-column') {
        copy.items = copy.items.map(item => ({ ...item, id: crypto.randomUUID(), done: false }));
      }
      this.board.cards.push(copy); this.createCardEl(copy); this.selection.add(copy.id);
    }
    this.refreshSelectionVisuals(); this.scheduleSave();
  }

  // ── Undo / redo ────────────────────────────────────────────────

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify({ cards: this.board.cards, connections: this.board.connections }));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify({ cards: this.board.cards, connections: this.board.connections }));
    const snap = JSON.parse(this.undoStack.pop()!);
    this.board.cards = snap.cards; this.board.connections = snap.connections ?? [];
    this.scheduleSave(); this.rebuildCards();
  }

  private redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify({ cards: this.board.cards, connections: this.board.connections }));
    const snap = JSON.parse(this.redoStack.pop()!);
    this.board.cards = snap.cards; this.board.connections = snap.connections ?? [];
    this.scheduleSave(); this.rebuildCards();
  }

  private rebuildCards(): void {
    this.exitConnectMode();
    this.inner.empty(); this.cardEls.clear(); this.connectionPaths.clear(); this.selection.clear();
    this.initConnectionLayer();
    for (const card of this.board.cards) this.createCardEl(card);
    this.refreshAllConnections();
  }

  // ── Toolbar ────────────────────────────────────────────────────

  private renderToolbar(): void {
    const tb = this.toolbarEl = this.container.createDiv('icon-board-freeform-toolbar');

    // Buttons wrapper (collapses to FAB on narrow screens)
    const btnsEl = tb.createDiv('icon-board-freeform-toolbar-btns');
    const close = () => this.closeFab();
    this.addToolbarBtn(btnsEl, 'Tile',      'layout-grid',  () => { this.addTile();      close(); });
    this.addToolbarBtn(btnsEl, 'Sticky',    'sticky-note',  () => { this.addSticky();    close(); });
    this.addToolbarBtn(btnsEl, 'Checklist', 'check-square', () => { this.addChecklist(); close(); });
    this.addToolbarBtn(btnsEl, 'Note Link', 'file-text',    () => { this.addNoteLink();  close(); });
    this.addToolbarBtn(btnsEl, 'Image',     'image',        () => { this.addImage();     close(); });
    this.addToolbarBtn(btnsEl, 'Bookmark',  'bookmark',     () => { this.addBookmark();  close(); });
    this.connectToolBtn = this.addToolbarBtn(btnsEl, 'Connect', 'share-2', () => {
      this.toggleConnectMode(); close();
    });
    this.addToolbarBtn(btnsEl, 'Kanban', 'columns-3', () => { this.addKanban(); close(); });

    // FAB toggle — only shown on narrow screens via CSS
    const fab = tb.createDiv('icon-board-freeform-toolbar-fab');
    fab.setAttribute('aria-label', 'Add card');
    setIcon(fab, 'plus');
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      tb.toggleClass('is-open');
      fab.empty();
      setIcon(fab, tb.hasClass('is-open') ? 'x' : 'plus');
    });
  }

  private closeFab(): void {
    if (!this.toolbarEl?.hasClass('is-open')) return;
    this.toolbarEl.removeClass('is-open');
    const fab = this.toolbarEl.querySelector('.icon-board-freeform-toolbar-fab') as HTMLElement | null;
    if (fab) { fab.empty(); setIcon(fab, 'plus'); }
  }

  private addToolbarBtn(tb: HTMLElement, label: string, icon: string, onClick: () => void): HTMLElement {
    const btn = tb.createDiv('icon-board-freeform-toolbar-btn');
    btn.setAttribute('tabindex', '0'); btn.setAttribute('aria-label', label);
    setIcon(btn.createDiv('icon-board-freeform-toolbar-btn-icon'), icon);
    btn.createEl('span', { text: label, cls: 'icon-board-freeform-toolbar-btn-label' });
    btn.addEventListener('click', onClick);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    return btn;
  }

  // ── Zoom pill ──────────────────────────────────────────────────

  private renderZoomPill(): void {
    this.zoomPill = this.container.createDiv('icon-board-zoom-pill');
    this.zoomPill.setAttribute('title', 'Click to reset zoom to 100%');
    this.zoomPill.setText(`${Math.round(this.vp.zoom * 100)}%`);
    this.zoomPill.addEventListener('click', () => { this.vp = { x: 0, y: 0, zoom: 1 }; this.applyViewport(); this.scheduleSave(); });
  }

  // ── Connection layer ───────────────────────────────────────────

  private initConnectionLayer(): void {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    svg.classList.add('icon-board-connections-svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;overflow:visible;pointer-events:none;';
    this.svgDefs = document.createElementNS(ns, 'defs') as SVGDefsElement;
    svg.appendChild(this.svgDefs);
    // First child of inner so all cards render on top of it
    if (this.inner.firstChild) this.inner.insertBefore(svg, this.inner.firstChild);
    else this.inner.appendChild(svg);
    this.svgEl = svg;
  }

  private refreshAllConnections(): void {
    this.connectionPaths.forEach(p => p.remove());
    this.connectionPaths.clear();
    this.connectionHitPaths.forEach(p => p.remove());
    this.connectionHitPaths.clear();
    this.connectionLabelEls.forEach(g => g.remove());
    this.connectionLabelEls.clear();
    this.connectionSelectPath?.remove(); this.connectionSelectPath = null;
    this.selectedConnectionId = null;
    this.hideConnectionProps();
    for (const conn of this.board.connections) this.renderSingleConnection(conn);
  }

  private renderSingleConnection(conn: Connection): void {
    const d = this.buildConnectionPath(conn); if (!d) return;
    const ns = 'http://www.w3.org/2000/svg';

    // Wide transparent hit area for easy clicking
    const hit = document.createElementNS(ns, 'path') as SVGPathElement;
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', '#000000');
    hit.setAttribute('stroke-opacity', '0');
    hit.setAttribute('stroke-width', '12');
    hit.setAttribute('fill', 'none');
    hit.style.cursor = 'pointer';
    hit.style.pointerEvents = 'stroke';
    hit.addEventListener('click', (e) => { e.stopPropagation(); this.selectConnection(conn.id); });
    hit.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.selectConnection(conn.id);
      const menu = new Menu();
      menu.addItem(i => i.setTitle('Delete connection').setIcon('trash-2').onClick(() => this.deleteSelectedConnection()));
      menu.showAtMouseEvent(e);
    });
    this.svgEl.appendChild(hit);
    this.connectionHitPaths.set(conn.id, hit);

    // Visible path (pointer-events:none so hit area handles all events)
    const path = document.createElementNS(ns, 'path') as SVGPathElement;
    path.setAttribute('d', d);
    path.setAttribute('stroke', conn.color);
    path.setAttribute('stroke-width', String(conn.thickness));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'butt');
    path.setAttribute('stroke-linejoin', 'round');
    path.style.pointerEvents = 'none';
    if (conn.style === 'dashed') {
      path.setAttribute('stroke-dasharray', `${conn.thickness * 5} ${conn.thickness * 4}`);
    }
    if (conn.arrowhead === 'end' || conn.arrowhead === 'both') {
      path.setAttribute('marker-end', `url(#${this.getOrCreateMarker(conn.color, conn.thickness, 'end')})`);
    }
    if (conn.arrowhead === 'both') {
      path.setAttribute('marker-start', `url(#${this.getOrCreateMarker(conn.color, conn.thickness, 'start')})`);
    }
    this.svgEl.appendChild(path);
    this.connectionPaths.set(conn.id, path);
    this.renderConnectionLabel(conn);
  }

  private buildConnectionPath(conn: Connection): string | null {
    const from = this.getCardRect(conn.fromCardId);
    const to   = this.getCardRect(conn.toCardId);
    if (!from || !to) return null;
    if (conn.routing === 'elbow') {
      const ori = resolveOrientation(from, to, conn.elbowOrientation ?? 'auto');
      const { src, tgt } = elbowAnchors(from, to, ori);
      return buildElbowPath(src, tgt, ori);
    }
    const { src, tgt } = straightAnchors(from, to);
    return buildStraightPath(src, tgt);
  }

  private getCardRect(cardId: string): { x: number; y: number; w: number; h: number } | null {
    const card = this.board.cards.find(c => c.id === cardId);
    if (!card) return null;
    return { x: card.x ?? 0, y: card.y ?? 0, w: card.w ?? TILE_DEFAULT_W, h: card.h ?? TILE_DEFAULT_H };
  }

  private connectionLabelPos(conn: Connection): { x: number; y: number } | null {
    const from = this.getCardRect(conn.fromCardId);
    const to   = this.getCardRect(conn.toCardId);
    if (!from || !to) return null;
    const { src, tgt } = conn.routing === 'elbow'
      ? elbowAnchors(from, to, resolveOrientation(from, to, conn.elbowOrientation ?? 'auto'))
      : straightAnchors(from, to);
    return { x: (src.x + tgt.x) / 2, y: (src.y + tgt.y) / 2 };
  }

  private renderConnectionLabel(conn: Connection): void {
    if (!conn.label) return;
    const pos = this.connectionLabelPos(conn); if (!pos) return;
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g') as SVGGElement;
    g.style.pointerEvents = 'none';
    const bg = getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#ffffff';
    const addText = (strokeColor: string | null, fillColor: string) => {
      const t = document.createElementNS(ns, 'text') as SVGTextElement;
      t.setAttribute('x', String(pos.x)); t.setAttribute('y', String(pos.y));
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('font-size', '11');
      if (strokeColor) { t.setAttribute('stroke', strokeColor); t.setAttribute('stroke-width', '5'); t.setAttribute('stroke-linejoin', 'round'); }
      t.setAttribute('fill', fillColor);
      t.textContent = conn.label ?? '';
      g.appendChild(t);
    };
    addText(bg, bg);
    addText(null, conn.color);
    this.svgEl.appendChild(g);
    this.connectionLabelEls.set(conn.id, g);
  }

  private updateConnectionsForCard(cardId: string): void {
    for (const conn of this.board.connections) {
      if (conn.fromCardId !== cardId && conn.toCardId !== cardId) continue;
      const d = this.buildConnectionPath(conn); if (!d) continue;
      this.connectionPaths.get(conn.id)?.setAttribute('d', d);
      this.connectionHitPaths.get(conn.id)?.setAttribute('d', d);
      if (this.selectedConnectionId === conn.id && this.connectionSelectPath) {
        this.connectionSelectPath.setAttribute('d', d);
      }
      const labelPos = this.connectionLabelPos(conn);
      const labelG = this.connectionLabelEls.get(conn.id);
      if (labelPos && labelG) {
        labelG.querySelectorAll('text').forEach(t => {
          t.setAttribute('x', String(labelPos.x));
          t.setAttribute('y', String(labelPos.y));
        });
      }
    }
  }

  private getOrCreateMarker(color: string, thickness: number, end: 'end' | 'start'): string {
    const id = `ibm-${end === 'end' ? 'e' : 's'}-${color.replace('#', '')}-${thickness}`;
    if (!this.svgDefs.querySelector(`#${id}`)) {
      const ns = 'http://www.w3.org/2000/svg';
      const size = 10 + thickness * 2;
      const mid  = Math.round(size * 0.42);
      const h    = mid * 2;
      const marker = document.createElementNS(ns, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('markerWidth', String(size));
      marker.setAttribute('markerHeight', String(h));
      marker.setAttribute('refX', end === 'end' ? String(size) : '0');
      marker.setAttribute('refY', String(mid));
      marker.setAttribute('orient', end === 'end' ? 'auto' : 'auto-start-reverse');
      const poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', `0 0, ${size} ${mid}, 0 ${h}`);
      poly.setAttribute('fill', color);
      marker.appendChild(poly);
      this.svgDefs.appendChild(marker);
    }
    return id;
  }

  // ── Connect mode ───────────────────────────────────────────────

  private enterConnectMode(): void {
    this.connectMode = true;
    this.outer.addClass('is-connect-mode');
    this.connectToolBtn?.addClass('is-active');
  }

  private exitConnectMode(): void {
    this.connectMode = false;
    this.outer?.removeClass('is-connect-mode');
    this.connectToolBtn?.removeClass('is-active');
    if (this.connectSourceId) {
      this.cardEls.get(this.connectSourceId)?.removeClass('is-connect-source');
      this.connectSourceId = null;
    }
    this.stopConnectSourceGhost();
  }

  private toggleConnectMode(): void {
    if (this.connectMode) this.exitConnectMode(); else this.enterConnectMode();
  }

  private addConnectionHandles(el: HTMLElement, card: SupportedCard): void {
    for (const side of ['n', 's', 'e', 'w'] as const) {
      const handle = el.createDiv(`icon-board-connection-handle icon-board-connection-handle-${side}`);
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        this.startHandleDrag(e, handle, card, side);
      });
    }
  }

  private startHandleDrag(
    e: PointerEvent, handleEl: HTMLElement,
    card: SupportedCard, side: 'n' | 's' | 'e' | 'w'
  ): void {
    const outerRect = this.outer.getBoundingClientRect();
    const srcEdge = this.getEdgeMidpoint(card, side);
    let hoveredId: string | null = null;

    const onMove = (ev: PointerEvent) => {
      const cp = screenToCanvas(ev.clientX - outerRect.left, ev.clientY - outerRect.top, this.vp);
      this.updateGhostPath(srcEdge.x, srcEdge.y, cp.x, cp.y);
      const id = this.cardIdAtPoint(ev.clientX, ev.clientY);
      const newHover = (id && id !== card.id) ? id : null;
      if (newHover !== hoveredId) {
        if (hoveredId) this.cardEls.get(hoveredId)?.removeClass('is-connect-target');
        hoveredId = newHover;
        if (hoveredId) this.cardEls.get(hoveredId)?.addClass('is-connect-target');
      }
    };

    const onUp = (ev: PointerEvent) => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      this.removeGhostPath();
      if (hoveredId) this.cardEls.get(hoveredId)?.removeClass('is-connect-target');
      const targetId = this.cardIdAtPoint(ev.clientX, ev.clientY);
      if (targetId && targetId !== card.id) this.finishConnection(card.id, targetId);
    };

    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
  }

  private getEdgeMidpoint(card: Card, side: 'n' | 's' | 'e' | 'w'): { x: number; y: number } {
    const cx = (card.x ?? 0) + (card.w ?? TILE_DEFAULT_W) / 2;
    const cy = (card.y ?? 0) + (card.h ?? TILE_DEFAULT_H) / 2;
    switch (side) {
      case 'n': return { x: cx, y: card.y ?? 0 };
      case 's': return { x: cx, y: (card.y ?? 0) + (card.h ?? TILE_DEFAULT_H) };
      case 'e': return { x: (card.x ?? 0) + (card.w ?? TILE_DEFAULT_W), y: cy };
      case 'w': return { x: card.x ?? 0, y: cy };
    }
  }

  private updateGhostPath(sx: number, sy: number, tx: number, ty: number): void {
    if (!this.ghostPath) {
      const ns = 'http://www.w3.org/2000/svg';
      this.ghostPath = document.createElementNS(ns, 'path') as SVGPathElement;
      this.ghostPath.setAttribute('fill', 'none');
      this.ghostPath.setAttribute('stroke', 'var(--interactive-accent)');
      this.ghostPath.setAttribute('stroke-width', '1.5');
      this.ghostPath.setAttribute('stroke-dasharray', '6 4');
      this.ghostPath.setAttribute('stroke-linecap', 'round');
      this.ghostPath.style.pointerEvents = 'none';
      this.svgEl.appendChild(this.ghostPath);
    }
    this.ghostPath.setAttribute('d', `M ${sx} ${sy} L ${tx} ${ty}`);
  }

  private removeGhostPath(): void {
    if (this.ghostPath) { this.ghostPath.remove(); this.ghostPath = null; }
  }

  private startConnectSourceGhost(sourceId: string): void {
    const sourceCard = this.board.cards.find(c => c.id === sourceId);
    if (!sourceCard) return;
    this.connectMoveListener = (ev: PointerEvent) => {
      const rect = this.outer.getBoundingClientRect();
      const cursor = screenToCanvas(ev.clientX - rect.left, ev.clientY - rect.top, this.vp);
      const rect2 = this.getCardRect(sourceId);
      if (!rect2) return;
      const fcx = rect2.x + rect2.w / 2, fcy = rect2.y + rect2.h / 2;
      const src = rectExitPoint(fcx, fcy, cursor.x, cursor.y, rect2);
      this.updateGhostPath(src.x, src.y, cursor.x, cursor.y);
    };
    this.outer.addEventListener('pointermove', this.connectMoveListener);
  }

  private stopConnectSourceGhost(): void {
    if (this.connectMoveListener) {
      this.outer.removeEventListener('pointermove', this.connectMoveListener);
      this.connectMoveListener = null;
    }
    this.removeGhostPath();
  }

  private cardIdAtPoint(clientX: number, clientY: number): string | null {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const cardEl = el.closest('[data-id]') as HTMLElement | null;
      if (cardEl?.dataset.id && this.cardEls.has(cardEl.dataset.id)) return cardEl.dataset.id;
    }
    return null;
  }

  private finishConnection(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const exists = this.board.connections.some(
      c => (c.fromCardId === fromId && c.toCardId === toId) ||
           (c.fromCardId === toId   && c.toCardId === fromId)
    );
    if (exists) return;
    const conn: Connection = {
      id: crypto.randomUUID(),
      fromCardId: fromId,
      toCardId: toId,
      routing: 'straight',
      color: this.resolveDefaultConnectionColor(),
      style: 'solid',
      arrowhead: 'end',
      thickness: 2,
    };
    this.pushUndo();
    this.board.connections.push(conn);
    this.renderSingleConnection(conn);
    this.scheduleSave();
  }

  private resolveDefaultConnectionColor(): string {
    const tmp = document.body.createDiv();
    tmp.style.cssText = 'position:absolute;visibility:hidden;color:var(--text-muted)';
    document.body.appendChild(tmp);
    const computed = getComputedStyle(tmp).color;
    tmp.remove();
    const m = computed.match(/\d+/g);
    if (!m || m.length < 3) return '#888888';
    return '#' + [m[0], m[1], m[2]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }

  // ── Connection selection & properties ─────────────────────────

  private selectConnection(id: string): void {
    if (this.selectedConnectionId === id) return;
    this.deselectConnection();
    this.selection.clear(); this.refreshSelectionVisuals();
    this.selectedConnectionId = id;
    const conn = this.board.connections.find(c => c.id === id); if (!conn) return;
    const d = this.buildConnectionPath(conn); if (!d) return;

    const ns = 'http://www.w3.org/2000/svg';
    this.connectionSelectPath = document.createElementNS(ns, 'path') as SVGPathElement;
    this.connectionSelectPath.setAttribute('d', d);
    this.connectionSelectPath.setAttribute('stroke', 'var(--interactive-accent)');
    this.connectionSelectPath.setAttribute('stroke-width', String(conn.thickness + 6));
    this.connectionSelectPath.setAttribute('stroke-opacity', '0.3');
    this.connectionSelectPath.setAttribute('fill', 'none');
    this.connectionSelectPath.setAttribute('stroke-linecap', 'round');
    this.connectionSelectPath.style.pointerEvents = 'none';
    const visPath = this.connectionPaths.get(id);
    if (visPath) this.svgEl.insertBefore(this.connectionSelectPath, visPath);
    else this.svgEl.appendChild(this.connectionSelectPath);
    this.showConnectionProps(conn);
  }

  private deselectConnection(): void {
    if (!this.selectedConnectionId) return;
    this.connectionSelectPath?.remove(); this.connectionSelectPath = null;
    this.selectedConnectionId = null;
    this.hideConnectionProps();
  }

  private rerenderConnection(conn: Connection): void {
    this.connectionPaths.get(conn.id)?.remove();
    this.connectionHitPaths.get(conn.id)?.remove();
    this.connectionPaths.delete(conn.id);
    this.connectionHitPaths.delete(conn.id);
    this.connectionLabelEls.get(conn.id)?.remove();
    this.connectionLabelEls.delete(conn.id);
    this.renderSingleConnection(conn);
    if (this.selectedConnectionId === conn.id && this.connectionSelectPath) {
      const d = this.buildConnectionPath(conn);
      if (d) {
        this.connectionSelectPath.setAttribute('d', d);
        this.connectionSelectPath.setAttribute('stroke-width', String(conn.thickness + 6));
      }
      // Move select halo before newly rendered visible path
      const visPath = this.connectionPaths.get(conn.id);
      if (visPath) this.svgEl.insertBefore(this.connectionSelectPath, visPath);
    }
  }

  private deleteSelectedConnection(): void {
    if (!this.selectedConnectionId) return;
    const id = this.selectedConnectionId;
    this.pushUndo();
    this.deselectConnection();
    this.board.connections = this.board.connections.filter(c => c.id !== id);
    this.connectionPaths.get(id)?.remove(); this.connectionPaths.delete(id);
    this.connectionHitPaths.get(id)?.remove(); this.connectionHitPaths.delete(id);
    this.connectionLabelEls.get(id)?.remove(); this.connectionLabelEls.delete(id);
    this.scheduleSave();
  }

  private showConnectionProps(conn: Connection): void {
    this.hideConnectionProps();
    const panel = this.container.createDiv('icon-board-conn-props');
    this.connPropsEl = panel;

    // ── Label ────────────────────────────────────────────────────
    const labelWrap = panel.createDiv('icon-board-conn-props-label-wrap');
    const labelInput = labelWrap.createEl('input');
    labelInput.type = 'text'; labelInput.placeholder = 'Add label…';
    labelInput.addClass('icon-board-conn-props-label-input');
    labelInput.value = conn.label ?? '';
    const origLabel = conn.label;
    labelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') labelInput.blur();
      else if (e.key === 'Escape') { labelInput.value = origLabel ?? ''; labelInput.blur(); }
      e.stopPropagation();
    });
    labelInput.addEventListener('blur', () => {
      const val = labelInput.value.trim() || undefined;
      if (val === conn.label) return;
      this.pushUndo(); conn.label = val;
      this.rerenderConnection(conn); this.scheduleSave();
    });

    panel.createDiv('icon-board-conn-props-sep');

    // ── Color swatches ──────────────────────────────────────────
    const colorGroup = panel.createDiv('icon-board-conn-props-group');
    for (const hex of CONN_COLOR_PRESETS) {
      const swatch = colorGroup.createDiv('icon-board-conn-props-swatch');
      swatch.style.background = hex;
      swatch.setAttribute('aria-label', hex);
      swatch.toggleClass('is-active', conn.color.toLowerCase() === hex);
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushUndo(); conn.color = hex;
        this.rerenderConnection(conn);
        colorGroup.querySelectorAll<HTMLElement>('.icon-board-conn-props-swatch').forEach(s => s.removeClass('is-active'));
        swatch.addClass('is-active');
        this.scheduleSave();
      });
    }

    panel.createDiv('icon-board-conn-props-sep');

    // ── Thickness ───────────────────────────────────────────────
    const thickGroup = panel.createDiv('icon-board-conn-props-group');
    for (const t of [2, 4, 6] as const) {
      const btn = thickGroup.createDiv('icon-board-conn-props-btn');
      btn.setAttribute('aria-label', `Thickness ${t}`);
      btn.toggleClass('is-active', conn.thickness === t);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '20'); svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 20 16');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '2'); line.setAttribute('y1', '8');
      line.setAttribute('x2', '18'); line.setAttribute('y2', '8');
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', String(t));
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line); btn.appendChild(svg);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushUndo(); conn.thickness = t;
        this.rerenderConnection(conn);
        thickGroup.querySelectorAll<HTMLElement>('.icon-board-conn-props-btn').forEach(b => b.removeClass('is-active'));
        btn.addClass('is-active');
        this.scheduleSave();
      });
    }

    panel.createDiv('icon-board-conn-props-sep');

    // ── Style: solid / dashed ───────────────────────────────────
    const styleGroup = panel.createDiv('icon-board-conn-props-group');
    for (const style of ['solid', 'dashed'] as const) {
      const btn = styleGroup.createDiv('icon-board-conn-props-btn');
      btn.setAttribute('aria-label', style);
      btn.toggleClass('is-active', conn.style === style);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '22'); svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 22 16');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '2'); line.setAttribute('y1', '8');
      line.setAttribute('x2', '20'); line.setAttribute('y2', '8');
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-linecap', 'round');
      if (style === 'dashed') line.setAttribute('stroke-dasharray', '4 3');
      svg.appendChild(line); btn.appendChild(svg);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushUndo(); conn.style = style;
        this.rerenderConnection(conn);
        styleGroup.querySelectorAll<HTMLElement>('.icon-board-conn-props-btn').forEach(b => b.removeClass('is-active'));
        btn.addClass('is-active');
        this.scheduleSave();
      });
    }

    panel.createDiv('icon-board-conn-props-sep');

    // ── Arrowhead ───────────────────────────────────────────────
    const arrowGroup = panel.createDiv('icon-board-conn-props-group');
    const arrowOpts: Array<{ val: Connection['arrowhead']; label: string; icon: string }> = [
      { val: 'none', label: 'No arrowheads', icon: 'minus'           },
      { val: 'end',  label: 'Arrow at end',  icon: 'arrow-right'     },
      { val: 'both', label: 'Both ends',     icon: 'arrow-left-right' },
    ];
    for (const { val, label, icon } of arrowOpts) {
      const btn = arrowGroup.createDiv('icon-board-conn-props-btn');
      btn.setAttribute('aria-label', label);
      btn.toggleClass('is-active', conn.arrowhead === val);
      setIcon(btn, icon);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushUndo(); conn.arrowhead = val;
        this.rerenderConnection(conn);
        arrowGroup.querySelectorAll<HTMLElement>('.icon-board-conn-props-btn').forEach(b => b.removeClass('is-active'));
        btn.addClass('is-active');
        this.scheduleSave();
      });
    }

    panel.createDiv('icon-board-conn-props-sep');

    // ── Routing ─────────────────────────────────────────────────
    const routeGroup = panel.createDiv('icon-board-conn-props-group');
    const routeOpts: Array<{ val: Connection['routing']; label: string; icon: string }> = [
      { val: 'straight', label: 'Straight line', icon: 'minus'            },
      { val: 'elbow',    label: 'Elbow route',   icon: 'corner-down-right' },
    ];
    for (const { val, label, icon } of routeOpts) {
      const btn = routeGroup.createDiv('icon-board-conn-props-btn');
      btn.setAttribute('aria-label', label);
      btn.toggleClass('is-active', conn.routing === val);
      setIcon(btn, icon);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushUndo(); conn.routing = val;
        this.rerenderConnection(conn);
        routeGroup.querySelectorAll<HTMLElement>('.icon-board-conn-props-btn').forEach(b => b.removeClass('is-active'));
        btn.addClass('is-active');
        this.scheduleSave();
      });
    }

    panel.createDiv('icon-board-conn-props-sep');

    // ── Delete ──────────────────────────────────────────────────
    const delBtn = panel.createDiv('icon-board-conn-props-btn icon-board-conn-props-delete');
    delBtn.setAttribute('aria-label', 'Delete connection');
    setIcon(delBtn, 'trash-2');
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteSelectedConnection(); });
  }

  private hideConnectionProps(): void {
    this.connPropsEl?.remove();
    this.connPropsEl = null;
  }

  // ── Save ───────────────────────────────────────────────────────

  private scheduleSave(): void {
    this.board.viewport = { ...this.vp };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, 600);
  }

  private async saveNow(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.board.viewport = { ...this.vp };
    await this.onSave(this.board);
  }
}
