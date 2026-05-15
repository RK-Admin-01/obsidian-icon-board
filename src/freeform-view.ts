import {
  App, TFile, TFolder, Menu, Notice, Modal, setIcon,
  MarkdownRenderer, Component, FuzzySuggestModal, requestUrl, sanitizeHTMLToDom,
} from 'obsidian';
import {
  IconBoardFile, TileCard, StickyCard, ChecklistCard, ChecklistItem, NoteLinkCard,
  ImageCard, AudioCard, BookmarkCard, KanbanColumnCard, KanbanItem, Card, Connection,
} from './file-types';
import {
  straightAnchors, elbowAnchors, buildStraightPath, buildElbowPath, resolveOrientation, rectExitPoint,
} from './canvas/geometry';
import { contrastColor } from './color-utils';
import { TileModal } from './tile-modal';
import { TextFormatToolbar } from './text-format-toolbar';
import { snap } from './canvas/snap';
import {
  Viewport, applyWheelZoom, applyPinchZoom,
  viewportTransform, screenToCanvas, clampZoom,
} from './canvas/pan-zoom';
import { SelectionManager } from './canvas/selection';
import { ContextBar, CtxEvent } from './context-bar';
import { sortAssetFile, saveNewAsset } from './asset-manager';

// ── Constants ──────────────────────────────────────────────────
const TILE_DEFAULT_W      = 140;
const TILE_DEFAULT_H      = 160;
const TILE_MIN_W          = 80;
const TILE_MIN_H          = 100;
const STICKY_DEFAULT_W    = 180;
const STICKY_DEFAULT_H    = 160;
const STICKY_MIN_W        = 120;
const STICKY_MIN_H        = 80;
const CHECKLIST_DEFAULT_W = 240;
const CHECKLIST_DEFAULT_H = 300;
const CHECKLIST_MIN_W     = 180;
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
const AUDIO_DEFAULT_W     = 280;
const AUDIO_DEFAULT_H     = 100;
const AUDIO_MIN_W         = 200;
const AUDIO_MIN_H         = 72;
const AUDIO_EXTS          = ['mp3', 'wav'];
const KANBAN_DEFAULT_W    = 220;
const KANBAN_DEFAULT_H    = 340;
const KANBAN_MIN_W        = 160;
const KANBAN_MIN_H        = 200;
const DOT_SPACING         = 32;
const MAX_UNDO            = 20;
const DRAG_THRESHOLD      = 5;

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
  { color: '#D1D5DB', name: 'Grey' },
  { color: '#F3F4F6', name: 'Light Grey' },
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

/** Typed wrapper for the private Obsidian dragManager API. */
interface DragManager {
  draggable?: { type: string; file?: unknown };
}
interface AppWithPrivateAPIs extends App {
  dragManager?: DragManager;
  plugins?: { enabledPlugins?: Set<string> };
}

type SupportedCard = TileCard | StickyCard | ChecklistCard | NoteLinkCard | ImageCard | AudioCard | BookmarkCard | KanbanColumnCard;

function cardMinSize(kind: Card['kind']): { w: number; h: number } {
  if (kind === 'sticky')    return { w: STICKY_MIN_W,    h: STICKY_MIN_H    };
  if (kind === 'checklist') return { w: CHECKLIST_MIN_W, h: CHECKLIST_MIN_H };
  if (kind === 'note-link') return { w: NOTELINK_MIN_W,  h: NOTELINK_MIN_H  };
  if (kind === 'image')     return { w: IMAGE_MIN_W,     h: IMAGE_MIN_H     };
  if (kind === 'bookmark')  return { w: BOOKMARK_MIN_W,  h: BOOKMARK_MIN_H  };
  if (kind === 'audio')     return { w: AUDIO_MIN_W,     h: AUDIO_MIN_H     };
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

class VaultAudioPickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (f: TFile) => void) { super(app); }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter(f => AUDIO_EXTS.includes(f.extension.toLowerCase()));
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
    input.addClass('ib-modal-text-input');
    if (this.current !== undefined) input.value = String(this.current);

    const btnRow = this.contentEl.createDiv();
    btnRow.addClass('ib-modal-btn-row');
    btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const setBtn = btnRow.createEl('button', { text: 'Set', cls: 'mod-cta' });
    setBtn.addEventListener('click', () => this.submit(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(input.value); }
      if (e.key === 'Escape') this.close();
    });
    window.setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  private submit(raw: string): void {
    const val = parseInt(raw.trim());
    this.close();
    this.onSubmit(isNaN(val) || val < 1 ? undefined : val);
  }

  onClose(): void { this.contentEl.empty(); }
}

class MediaSourceModal extends Modal {
  constructor(
    app: App,
    private label: string,
    private onVault: () => void,
    private onUpload: () => void
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.label, cls: 'icon-board-media-source-title' });
    const vaultBtn = contentEl.createEl('button', {
      text: 'Choose from vault…',
      cls: 'mod-cta icon-board-media-source-btn',
    });
    vaultBtn.addEventListener('click', () => { this.close(); this.onVault(); });
    contentEl.createEl('div', { cls: 'icon-board-media-source-sep' });
    const uploadBtn = contentEl.createEl('button', {
      text: 'Upload from disk…',
      cls: 'icon-board-media-source-btn',
    });
    uploadBtn.addEventListener('click', () => { this.close(); this.onUpload(); });
  }
}

class TagInputModal extends Modal {
  constructor(app: App, private onSubmit: (tag: string) => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h3', { text: 'Add tag' });
    const input = this.contentEl.createEl('input');
    input.type = 'text'; input.placeholder = 'tag name (no #)';
    input.addClass('ib-modal-text-input');
    const btnRow = this.contentEl.createDiv();
    btnRow.addClass('ib-modal-btn-row');
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
    window.setTimeout(() => input.focus(), 50);
  }
  onClose(): void { this.contentEl.empty(); }
}

class BookmarkInputModal extends Modal {
  constructor(app: App, private onSubmit: (url: string) => void) { super(app); }

  onOpen(): void {
    this.contentEl.createEl('h3', { text: 'Add bookmark' });
    const input = this.contentEl.createEl('input', { cls: 'icon-board-bookmark-url-input' });
    input.type = 'text'; input.placeholder = 'https://…';
    input.addClass('ib-modal-text-input');

    const btnRow = this.contentEl.createDiv();
    btnRow.addClass('ib-modal-btn-row');
    const cancel = btnRow.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const add = btnRow.createEl('button', { text: 'Add', cls: 'mod-cta' });
    add.addEventListener('click', () => this.submit(input.value));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(input.value); }
      if (e.key === 'Escape') this.close();
    });
    window.setTimeout(() => input.focus(), 50);
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
  private fabEl: HTMLElement | null = null;
  private svgEl!: SVGSVGElement;
  private svgDefs!: SVGDefsElement;
  private connectionPaths = new Map<string, SVGPathElement>();

  private connectMode = false;
  private connectSourceId: string | null = null;
  private ghostPath: SVGPathElement | null = null;
  private connectToolBtn: HTMLElement | null = null;
  private dotsToggleBtn: HTMLElement | null = null;
  private connectMoveListener: ((e: PointerEvent) => void) | null = null;

  private connectionHitPaths = new Map<string, SVGPathElement>();
  private hitSvgEl!: SVGSVGElement;
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

  private saveTimer: number | null = null;
  private alignBarEl: HTMLElement | null = null;
  private pendingTool: string | null = null;
  private pendingToolBtn: HTMLElement | null = null;
  private overflowPopover: HTMLElement | null = null;
  private contextBar!: ContextBar;
  private activeStickyApplyTag: ((tag: string) => void) | null = null;

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
    private bookmarkCacheDays = 30,
    private defaultStickyColor?: string,
    private toolbarPosition: 'left' | 'right' | 'top' | 'bottom' = 'left'
  ) {
    super();
    this.vp = { ...(board.viewport ?? { x: 0, y: 0, zoom: 1 }) };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  render(): void {
    this.container.addClass('ib-freeform-host');
    this.container.empty();
    this.cardEls.clear();
    this.connectionPaths.clear();

    this.outer = this.container.createDiv('icon-board-canvas-outer');
    this.outer.setAttribute('tabindex', '0');
    if (this.board.dotsHidden) this.outer.addClass('no-dots');
    this.inner = this.outer.createDiv('icon-board-canvas-inner');
    this.marqueeEl = this.outer.createDiv('icon-board-marquee');
    this.marqueeEl.hide();

    // SVG connection layer goes first so it renders behind cards
    this.initConnectionLayer();

    for (const card of this.board.cards) this.createCardEl(card);
    this.refreshAllConnections();

    this.applyViewport();
    this.bindCanvasEvents();
    this.renderToolbar();
    this.renderAlignBar();
    this.renderZoomPill();

    // Re-fetch stale bookmarks
    for (const card of this.board.cards) {
      if (card.kind !== 'bookmark' || card.fetchFailed) continue;
      if (!card.fetchedAt || Date.now() - card.fetchedAt > this.bookmarkCacheDays * 86_400_000) {
        const el = this.cardEls.get(card.id);
        if (el) void this.fetchAndUpdateBookmark(card, el);
      }
    }

    window.setTimeout(() => this.outer.focus(), 0);
  }

  destroy(): void {
    this.exitConnectMode();
    this.deselectConnection();
    activeDocument.removeEventListener('keydown', this.docKeyDown);
    activeDocument.removeEventListener('keyup', this.docKeyUp);
    if (this.saveTimer) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.unload();
  }

  private setCursor(cursor: '' | 'grab' | 'grabbing' | 'crosshair'): void {
    this.outer.removeClass('ib-cursor-grab', 'ib-cursor-grabbing', 'ib-cursor-crosshair');
    if (cursor) this.outer.addClass(`ib-cursor-${cursor}`);
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
      if (e.code === 'Space' && activeDocument.activeElement === this.outer) {
        e.preventDefault(); this.spaceDown = true;
        if (!this.isPanning) this.setCursor('grab');
      }
    };
    this.docKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        if (!this.isPanning) this.setCursor('');
      }
    };
    activeDocument.addEventListener('keydown', this.docKeyDown);
    activeDocument.addEventListener('keyup', this.docKeyUp);

    // Capture-phase listeners: intercept middle-click / space-drag over any child
    // element before its stopPropagation can block panning.
    // The mousedown guard prevents Chrome autoscroll on scrollable/image targets.
    this.outer.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    }, { capture: true });
    this.outer.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
        e.preventDefault(); e.stopPropagation(); this.startPan(e);
      }
    }, { capture: true });

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
      } else if (e.button === 0 && this.pendingTool) {
        e.preventDefault();
        const rect = this.outer.getBoundingClientRect();
        const cp = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, this.vp);
        this.placePendingTool(cp.x, cp.y);
      } else if (e.button === 0) {
        this.closeOverflow();
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
      menu.addItem(i => i.setTitle('Add audio').setIcon('music').onClick(() =>
        this.addAudioAt(snap(cp.x - AUDIO_DEFAULT_W / 2), snap(cp.y - AUDIO_DEFAULT_H / 2))));
      menu.addItem(i => i.setTitle('Add bookmark').setIcon('bookmark').onClick(() =>
        this.addBookmarkAt(snap(cp.x - BOOKMARK_DEFAULT_W / 2), snap(cp.y - BOOKMARK_DEFAULT_H / 2))));
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Reset view').setIcon('maximize').onClick(() => {
        this.vp = { x: 0, y: 0, zoom: 1 }; this.applyViewport(); this.scheduleSave();
      }));
      menu.showAtMouseEvent(e);
    });

    // Clipboard paste
    this.outer.addEventListener('paste', (e) => { void (async () => {
      const active = activeDocument.activeElement;
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
    })(); });

    // Drag-and-drop from Finder or vault sidebar
    this.outer.addEventListener('dragover', (e) => {
      if (this.isDropAccepted(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }
    });
    this.outer.addEventListener('drop', (e) => { void (async () => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files?.length) {
        const rect = this.outer.getBoundingClientRect();
        let offsetX = 0;
        for (const f of Array.from(files)) {
          if (f.type.startsWith('image/')) {
            const cp = screenToCanvas(e.clientX - rect.left + offsetX, e.clientY - rect.top, this.vp);
            await this.handleDroppedImage(f, snap(cp.x - IMAGE_DEFAULT_W / 2), snap(cp.y - IMAGE_DEFAULT_H / 2));
            offsetX += IMAGE_DEFAULT_W + 16;
          } else if (f.type.startsWith('audio/')) {
            const cp = screenToCanvas(e.clientX - rect.left + offsetX, e.clientY - rect.top, this.vp);
            await this.handleDroppedAudio(f, snap(cp.x - AUDIO_DEFAULT_W / 2), snap(cp.y - AUDIO_DEFAULT_H / 2));
            offsetX += AUDIO_DEFAULT_W + 16;
          }
        }
        return;
      }
      // Vault sidebar file drag
      const dragMgr = (this.app as AppWithPrivateAPIs).dragManager;
      const draggable = dragMgr?.draggable;
      if (draggable?.type === 'file' && draggable.file instanceof TFile) {
        const vf = draggable.file;
        const ext = vf.extension.toLowerCase();
        const rect = this.outer.getBoundingClientRect();
        const cp = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, this.vp);
        if (IMAGE_EXTS.includes(ext)) {
          const newPath = await sortAssetFile(this.app, vf);
          const newFile = this.app.vault.getAbstractFileByPath(newPath);
          if (!(newFile instanceof TFile)) return;
          const h = await this.measureImageH(this.app.vault.getResourcePath(newFile));
          const card: ImageCard = {
            id: crypto.randomUUID(), kind: 'image',
            x: snap(cp.x - IMAGE_DEFAULT_W / 2), y: snap(cp.y - h / 2),
            w: IMAGE_DEFAULT_W, h, z: this.nextZ(),
            source: { type: 'vault', path: newPath }, captionHidden: true,
          };
          this.pushUndo(); this.board.cards.push(card); await this.saveNow();
          this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
        } else if (AUDIO_EXTS.includes(ext)) {
          const newPath = await sortAssetFile(this.app, vf);
          const card: AudioCard = {
            id: crypto.randomUUID(), kind: 'audio',
            x: snap(cp.x - AUDIO_DEFAULT_W / 2), y: snap(cp.y - AUDIO_DEFAULT_H / 2),
            w: AUDIO_DEFAULT_W, h: AUDIO_DEFAULT_H, z: this.nextZ(),
            source: { type: 'vault', path: newPath },
          };
          this.pushUndo(); this.board.cards.push(card); await this.saveNow();
          this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
        }
      }
    })(); });
  }

  // ── Pan ────────────────────────────────────────────────────────

  private startPan(e: PointerEvent): void {
    this.isPanning = true; this.setCursor('grabbing');
    const sx = e.clientX, sy = e.clientY, svx = this.vp.x, svy = this.vp.y;
    const pid = e.pointerId;
    // Use window capture-phase listeners so autoscroll or child stopPropagation
    // can't block move/up events (e.g. middle-click over <img> or scrollable kanban).
    const onMove = (me: PointerEvent) => {
      if (me.pointerId !== pid) return;
      this.vp = { ...this.vp, x: svx + (me.clientX - sx), y: svy + (me.clientY - sy) };
      this.applyViewport();
    };
    const onUp = (ue: PointerEvent) => {
      if (ue.pointerId !== pid) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      this.isPanning = false; this.setCursor(this.spaceDown ? 'grab' : ''); this.scheduleSave();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  }

  // ── Marquee ────────────────────────────────────────────────────

  private startMarquee(e: PointerEvent): void {
    const rect = this.outer.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    this.marqueeEl.style.left = `${sx}px`;
    this.marqueeEl.style.top = `${sy}px`;
    this.marqueeEl.setCssProps({ '--ib-marquee-w': '0px', '--ib-marquee-h': '0px' });
    this.marqueeEl.show();
    this.outer.setPointerCapture(e.pointerId);
    const onMove = (e: PointerEvent) => {
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      this.marqueeEl.style.left = `${Math.min(sx, cx)}px`;
      this.marqueeEl.style.top  = `${Math.min(sy, cy)}px`;
      this.marqueeEl.setCssProps({ '--ib-marquee-w': `${Math.abs(cx - sx)}px`, '--ib-marquee-h': `${Math.abs(cy - sy)}px` });
    };
    const onUp = (e: PointerEvent) => {
      this.outer.removeEventListener('pointermove', onMove); this.outer.removeEventListener('pointerup', onUp);
      this.marqueeEl.hide();
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
    // Sticky notes auto-size to content — only use saved height for other card types
    el.style.height = card.kind === 'sticky' ? '' : `${card.h ?? TILE_DEFAULT_H}px`;
    el.style.zIndex = String(card.z ?? 0);
  }

  // ── Content dispatch ───────────────────────────────────────────

  private renderCardContent(el: HTMLElement, card: SupportedCard): void {
    el.empty();
    el.removeClass(
      'icon-board-freeform-tile-card', 'icon-board-freeform-sticky-card',
      'icon-board-freeform-checklist-card', 'icon-board-freeform-notelink-card',
      'icon-board-freeform-image-card', 'icon-board-freeform-audio-card',
      'icon-board-freeform-bookmark-card'
    );
    switch (card.kind) {
      case 'tile':      this.renderTileContent(el, card);      break;
      case 'sticky':    this.renderStickyContent(el, card);    break;
      case 'checklist': this.renderChecklistContent(el, card); break;
      case 'note-link': this.renderNoteLinkContent(el, card);  break;
      case 'image':     this.renderImageContent(el, card);     break;
      case 'audio':     this.renderAudioContent(el, card);     break;
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
    this.appendResizeHandles(el);
  }

  // ── Sticky ─────────────────────────────────────────────────────

  private renderStickyContent(el: HTMLElement, card: StickyCard): void {
    el.addClass('icon-board-freeform-sticky-card');
    el.style.backgroundColor = card.color;
    if (card.topColor) {
      const strip = el.createDiv('ib-card-top-strip');
      strip.style.backgroundColor = card.topColor;
    }
    const inner = el.createDiv('icon-board-sticky-inner');
    const textEl = inner.createDiv('icon-board-sticky-text');
    if (card.textScale) textEl.addClass(`text-scale-${card.textScale}`);
    if (card.textColor) textEl.style.color = card.textColor;
    if (card.textAlign) textEl.style.textAlign = card.textAlign;
    void MarkdownRenderer.render(this.app, card.text || '*Double-click to edit…*', textEl, '', this);
    this.appendResizeHandles(el);
  }

  private editStickyInline(el: HTMLElement, card: StickyCard): void {
    const textEl = el.querySelector<HTMLElement>('.icon-board-sticky-text');
    if (!textEl || el.querySelector('.icon-board-sticky-editor')) return;
    const inner = el.querySelector<HTMLElement>('.icon-board-sticky-inner') ?? el;

    const editor = inner.createDiv('icon-board-sticky-editor');
    editor.contentEditable = 'true';
    editor.empty();
    if (card.text) editor.appendChild(sanitizeHTMLToDom(textEl.innerHTML));
    textEl.hide();

    editor.focus();
    const r = activeDocument.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);

    editor.addEventListener('pointerdown', e => e.stopPropagation());

    // ── Inline tag toggle ─────────────────────────────────────────
    let savedRange: Range | null = null;

    const applyTag = (tag: string) => {
      // Keep editor focused throughout — sel.removeAllRanges() can move focus to body
      editor.focus();
      const sel = window.getSelection();
      if (savedRange) { sel?.removeAllRanges(); sel?.addRange(savedRange.cloneRange()); }
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return;

      const ancestor = range.commonAncestorContainer;
      const existing = (ancestor.nodeType === Node.ELEMENT_NODE
        ? ancestor as Element : ancestor.parentElement)?.closest(tag);
      if (existing && editor.contains(existing)) {
        // Unwrap — move children out, then re-select them
        const children = Array.from(existing.childNodes);
        const p = existing.parentNode!;
        while (existing.firstChild) p.insertBefore(existing.firstChild, existing);
        existing.remove();
        if (children.length > 0 && p.contains(children[0]) && p.contains(children[children.length - 1])) {
          const nr = activeDocument.createRange();
          nr.setStartBefore(children[0]);
          nr.setEndAfter(children[children.length - 1]);
          sel.removeAllRanges(); sel.addRange(nr);
          savedRange = nr.cloneRange();
        } else {
          sel.removeAllRanges(); savedRange = null;
        }
      } else {
        // Wrap — re-select the new wrapper's contents
        const wrapper = activeDocument.createElement(tag);
        const extracted = range.extractContents();
        const tmp = activeDocument.createElement('div');
        tmp.appendChild(extracted);
        tmp.querySelectorAll(tag).forEach(n => n.replaceWith(...Array.from(n.childNodes)));
        while (tmp.firstChild) wrapper.appendChild(tmp.firstChild);
        range.insertNode(wrapper);
        wrapper.parentElement?.normalize();
        const nr = activeDocument.createRange();
        nr.selectNodeContents(wrapper);
        sel.removeAllRanges(); sel.addRange(nr);
        savedRange = nr.cloneRange();
      }
      // Re-focus after selection manipulation in case browser moved focus away
      editor.focus();
    };

    this.activeStickyApplyTag = applyTag;

    // Track selection so context-bar buttons can restore it after stealing focus
    const onSelChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editor.contains(sel.anchorNode)) { savedRange = null; return; }
      savedRange = sel.getRangeAt(0).cloneRange();
    };
    activeDocument.addEventListener('selectionchange', onSelChange);

    // Register on window (not document) so we fire before Obsidian's document-level
    // capture handlers, which intercept CMD+B/I/U before we ever see them.
    const onFormatKey = (e: KeyboardEvent) => {
      if (activeDocument.activeElement !== editor) return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (!e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); applyTag('strong'); return; }
      if (!e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); applyTag('em'); return; }
      if (!e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); applyTag('u'); return; }
      if (e.shiftKey  && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); applyTag('s'); return; }
    };
    window.addEventListener('keydown', onFormatKey, true);

    const cleanup = () => {
      activeDocument.removeEventListener('selectionchange', onSelChange);
      window.removeEventListener('keydown', onFormatKey, true);
      this.activeStickyApplyTag = null;
    };

    const commit = () => {
      if (!el.contains(editor)) return;
      cleanup();
      this.pushUndo();
      card.text = editor.innerHTML;
      editor.remove(); textEl.show();
      textEl.empty();
      void MarkdownRenderer.render(this.app, card.text || '*Double-click to edit…*', textEl, '', this);
      this.scheduleSave();
    };
    editor.addEventListener('blur', commit);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); cleanup();
        editor.removeEventListener('blur', commit);
        editor.remove(); textEl.show();
      }
    });
  }

  // ── Checklist ──────────────────────────────────────────────────

  private renderChecklistContent(el: HTMLElement, card: ChecklistCard): void {
    el.addClass('icon-board-freeform-checklist-card');
    el.style.backgroundColor = card.color;

    // Top strip (optional — only shown if accentColor is set)
    if (card.accentColor) {
      const accentBar = el.createDiv('icon-board-checklist-accent');
      accentBar.style.backgroundColor = card.accentColor;
    }

    // Title (hidden when titleHidden is true)
    if (!card.titleHidden) {
      const titleEl = el.createEl('input', { cls: 'icon-board-checklist-title' });
      titleEl.type = 'text'; titleEl.value = card.title || ''; titleEl.placeholder = 'Checklist';
      titleEl.addEventListener('pointerdown', e => e.stopPropagation());
      titleEl.addEventListener('input', () => { card.title = titleEl.value; });
      titleEl.addEventListener('blur', () => this.scheduleSave());
    }

    // List
    const listEl = el.createDiv('icon-board-checklist-list');
    for (const item of card.items) this.appendChecklistItem(listEl, card, item);
    this.appendChecklistGhost(listEl, card);

    this.appendResizeHandles(el);
  }

  private appendChecklistItem(listEl: HTMLElement, card: ChecklistCard, item: ChecklistItem): HTMLElement {
    const row = listEl.createDiv('icon-board-checklist-item');
    row.dataset.id = item.id;
    if (item.done) row.addClass('is-done');
    if (item.isHeader) row.addClass('is-header');
    if (item.parentId) row.addClass('is-child');

    const cb = row.createEl('input');
    cb.type = 'checkbox'; cb.checked = item.done; cb.className = 'icon-board-checklist-cb';
    if (item.isHeader) this.setHeaderCheckboxState(cb, card, item.id);

    cb.addEventListener('pointerdown', e => e.stopPropagation());
    cb.addEventListener('change', () => {
      // Cascade to any children of this item
      const children = card.items.filter(i => i.parentId === item.id);
      for (const child of children) {
        child.done = cb.checked;
        const childRow = listEl.querySelector<HTMLElement>(`[data-id="${child.id}"]`);
        if (childRow) {
          childRow.toggleClass('is-done', child.done);
          const childCb = childRow.querySelector<HTMLInputElement>('.icon-board-checklist-cb');
          if (childCb) { childCb.checked = cb.checked; childCb.indeterminate = false; }
        }
      }
      item.done = cb.checked;
      row.toggleClass('is-done', item.done);
      if (item.parentId) this.refreshHeaderCheckbox(listEl, card, item.parentId);
      this.scheduleSave();
    });

    const textDiv = row.createDiv('icon-board-checklist-item-input') as HTMLElement;
    textDiv.contentEditable = 'true';
    textDiv.dataset.placeholder = item.isHeader ? 'Section…' : 'Add a task…';
    if (item.text) textDiv.appendChild(sanitizeHTMLToDom(item.text));
    textDiv.addEventListener('pointerdown', e => e.stopPropagation());

    let fmtToolbar: TextFormatToolbar | null = null;
    textDiv.addEventListener('focus', () => {
      if (!fmtToolbar) fmtToolbar = new TextFormatToolbar(textDiv, row, this.container);
    });
    textDiv.addEventListener('blur', () => {
      fmtToolbar?.destroy(); fmtToolbar = null;
      item.text = textDiv.innerHTML;
      this.scheduleSave();
    });
    textDiv.addEventListener('input', () => { item.text = textDiv.innerHTML; });
    textDiv.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        const idx = card.items.indexOf(item);
        const ni: ChecklistItem = { id: crypto.randomUUID(), text: '', done: false, parentId: item.parentId };
        card.items.splice(idx + 1, 0, ni);
        const nr = this.appendChecklistItem(listEl, card, ni);
        row.after(nr);
        window.setTimeout(() => nr.querySelector<HTMLElement>('.icon-board-checklist-item-input')?.focus(), 0);
      }
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) {
          if (item.parentId) {
            item.parentId = undefined;
            row.removeClass('is-child');
            this.scheduleSave();
          }
        } else if (!item.parentId && !item.isHeader) {
          const idx = card.items.indexOf(item);
          for (let i = idx - 1; i >= 0; i--) {
            const above = card.items[i];
            if (above.isHeader || !above.parentId) {
              item.parentId = above.id;
              row.addClass('is-child');
              this.scheduleSave();
              break;
            }
          }
        }
      }
      if (e.key === 'Backspace' && (textDiv.innerHTML === '' || textDiv.innerHTML === '<br>')) {
        const idx = card.items.indexOf(item);
        if (idx > 0) {
          e.preventDefault(); e.stopPropagation();
          card.items.splice(idx, 1);
          const prev = row.previousElementSibling as HTMLElement | null;
          row.remove();
          prev?.querySelector<HTMLElement>('.icon-board-checklist-item-input')?.focus();
          this.scheduleSave();
        }
      }
    });
    return row;
  }

  private appendChecklistGhost(listEl: HTMLElement, card: ChecklistCard): HTMLElement {
    const row = listEl.createDiv('icon-board-checklist-item icon-board-checklist-ghost');

    const cb = row.createEl('input');
    cb.type = 'checkbox'; cb.className = 'icon-board-checklist-cb'; cb.disabled = true;
    cb.addEventListener('pointerdown', e => e.stopPropagation());

    const input = row.createEl('input');
    input.type = 'text'; input.placeholder = 'Add a task…';
    input.className = 'icon-board-checklist-item-input';
    input.addEventListener('pointerdown', e => e.stopPropagation());

    let committed = false;
    const commit = () => {
      if (committed) return;
      const text = input.value.trim();
      if (!text) return;
      committed = true;
      const newItem: ChecklistItem = { id: crypto.randomUUID(), text, done: false };
      this.pushUndo(); card.items.push(newItem);
      row.remove();
      this.appendChecklistItem(listEl, card, newItem);
      this.appendChecklistGhost(listEl, card);
      this.scheduleSave();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!input.value.trim()) return;
        commit();
        window.setTimeout(() => listEl.querySelector<HTMLInputElement>('.icon-board-checklist-ghost .icon-board-checklist-item-input')?.focus(), 0);
      } else if (e.key === 'Escape') {
        e.preventDefault(); input.value = ''; input.blur();
      }
    });

    return row;
  }

  private setHeaderCheckboxState(cb: HTMLInputElement, card: ChecklistCard, headerId: string): void {
    const children = card.items.filter(i => i.parentId === headerId);
    const doneCount = children.filter(i => i.done).length;
    if (children.length === 0) { cb.indeterminate = false; return; }
    if (doneCount === children.length) { cb.checked = true; cb.indeterminate = false; }
    else if (doneCount > 0) { cb.indeterminate = true; }
    else { cb.checked = false; cb.indeterminate = false; }
  }

  private refreshHeaderCheckbox(listEl: HTMLElement, card: ChecklistCard, headerId: string): void {
    const headerItem = card.items.find(i => i.id === headerId);
    if (!headerItem) return;
    const headerRow = listEl.querySelector<HTMLElement>(`[data-id="${headerId}"]`);
    const headerCb = headerRow?.querySelector<HTMLInputElement>('.icon-board-checklist-cb');
    if (!headerCb) return;
    const children = card.items.filter(i => i.parentId === headerId);
    const doneCount = children.filter(i => i.done).length;
    if (children.length === 0) return;
    if (doneCount === children.length) {
      headerCb.checked = true; headerCb.indeterminate = false;
    } else if (doneCount > 0) {
      headerCb.indeterminate = true;
    } else {
      headerCb.checked = false; headerCb.indeterminate = false;
    }
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
        void this.app.vault.cachedRead(f).then(content => {
          if (!el.contains(previewEl)) return;
          previewEl.empty();
          void MarkdownRenderer.render(this.app, content, previewEl, f.path, this);
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

    this.appendResizeHandles(el);
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

    const fixAspect = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const correctH = Math.max(IMAGE_MIN_H, snap(card.w * img.naturalHeight / img.naturalWidth));
        if (correctH !== card.h) {
          card.h = correctH;
          el.style.height = `${correctH}px`;
          this.scheduleSave();
        }
      }
    };
    img.addEventListener('load', fixAspect);
    if (img.complete) fixAspect();

    // Caption — render/edit two-state with TextFormatToolbar
    const captionWrap = el.createDiv('icon-board-image-caption-wrap');
    if (card.captionHidden) captionWrap.addClass('is-hidden');

    const captionViewEl = captionWrap.createDiv('icon-board-image-caption-view');
    if (card.captionScale) captionViewEl.addClass(`text-scale-${card.captionScale}`);
    if (card.captionColor) captionViewEl.style.color = card.captionColor;
    const renderCaptionView = () => {
      captionViewEl.empty();
      if (card.caption) {
        void MarkdownRenderer.render(this.app, card.caption, captionViewEl, '', this);
      } else {
        captionViewEl.createSpan({ cls: 'icon-board-caption-placeholder', text: 'Add caption…' });
      }
    };
    renderCaptionView();

    const captionEditor = captionWrap.createDiv('icon-board-image-caption-editor') as HTMLElement;
    captionEditor.contentEditable = 'true';
    captionEditor.hide();
    captionEditor.addEventListener('pointerdown', e => e.stopPropagation());

    let captionFmtToolbar: TextFormatToolbar | null = null;

    const enterCaptionEdit = () => {
      captionViewEl.hide();
      captionEditor.show();
      captionEditor.empty();
      if (card.caption) captionEditor.appendChild(sanitizeHTMLToDom(captionViewEl.innerHTML));
      captionEditor.focus();
      const r = activeDocument.createRange();
      r.selectNodeContents(captionEditor); r.collapse(false);
      const s = window.getSelection();
      s?.removeAllRanges(); s?.addRange(r);
      captionFmtToolbar = new TextFormatToolbar(captionEditor, captionWrap, this.container);
    };

    const exitCaptionEdit = () => {
      captionFmtToolbar?.destroy(); captionFmtToolbar = null;
      card.caption = captionEditor.innerHTML;
      captionEditor.hide();
      captionViewEl.show();
      renderCaptionView();
      this.scheduleSave();
    };

    captionViewEl.addEventListener('click', (e) => { e.stopPropagation(); enterCaptionEdit(); });
    captionViewEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    captionEditor.addEventListener('blur', exitCaptionEdit);
    captionEditor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        captionFmtToolbar?.destroy(); captionFmtToolbar = null;
        captionEditor.removeEventListener('blur', exitCaptionEdit);
        captionEditor.hide();
        captionViewEl.show();
        renderCaptionView();
      }
    });

    this.appendResizeHandles(el);
  }

  // ── Audio ──────────────────────────────────────────────────────

  private renderAudioContent(el: HTMLElement, card: AudioCard): void {
    el.addClass('icon-board-freeform-audio-card');
    const header = el.createDiv('icon-board-audio-header');
    const iconEl = header.createDiv('icon-board-audio-icon');
    setIcon(iconEl, 'music');
    const name = card.title ?? card.source.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Audio';
    header.createDiv({ cls: 'icon-board-audio-title', text: name });
    const vf = this.app.vault.getAbstractFileByPath(card.source.path);
    if (vf instanceof TFile) {
      const audio = el.createEl('audio');
      audio.src = this.app.vault.getResourcePath(vf);
      audio.controls = true;
      audio.addClass('icon-board-audio-player');
      audio.addEventListener('pointerdown', (e) => e.stopPropagation());
      audio.addEventListener('click', (e) => e.stopPropagation());
    } else {
      el.createDiv({ cls: 'icon-board-audio-missing', text: 'File not found' });
    }
    this.appendResizeHandles(el);
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
        void this.fetchAndUpdateBookmark(card, el);
      });
    } else if (!card.title && !card.fetchedAt) {
      const loading = el.createDiv('icon-board-bookmark-loading');
      const spinnerEl = loading.createDiv('icon-board-bookmark-spinner');
      setIcon(spinnerEl, 'loader');
      loading.createDiv({ cls: 'icon-board-bookmark-loading-text', text: 'Fetching preview…' });
      try { el.createDiv({ cls: 'icon-board-bookmark-domain', text: new URL(card.url).hostname }); } catch { /* ignore */ }
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
      try { footer.createDiv({ cls: 'icon-board-bookmark-domain', text: new URL(card.url).hostname }); } catch { /* ignore */ }
    }

    this.appendResizeHandles(el);
  }

  // ── Kanban column ──────────────────────────────────────────────

  private renderKanbanColumnContent(el: HTMLElement, card: KanbanColumnCard): void {
    el.addClass('icon-board-freeform-kanban-card');
    if (card.bgColor) el.style.backgroundColor = card.bgColor;
    if (card.topColor) {
      const strip = el.createDiv('ib-card-top-strip');
      strip.style.backgroundColor = card.topColor;
    }

    const header = el.createDiv('icon-board-kanban-header');

    let titleEl: HTMLElement | null = null;
    if (!card.titleHidden) {
      titleEl = header.createDiv('icon-board-kanban-title');
      if (card.color) titleEl.style.color = card.color;
      if (card.title) {
        titleEl.setText(card.title);
      } else {
        titleEl.addClass('icon-board-kanban-title-empty');
        titleEl.setText('Untitled');
      }
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (titleEl) this.editKanbanTitle(card, el, titleEl);
      });
    }

    const countRow = header.createDiv('icon-board-kanban-count-row');
    countRow.createSpan({ cls: 'icon-board-kanban-col-count' });
    this.updateKanbanCount(card, el);

    // Collapse toggle button
    const collapseBtn = header.createDiv('icon-board-kanban-collapse-btn');
    setIcon(collapseBtn, 'chevron-down');
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushUndo();
      card.collapsed = !card.collapsed;
      el.toggleClass('is-collapsed', !!card.collapsed);
      if (card.collapsed) {
        el.style.height = '';
      } else {
        el.style.height = `${card.h ?? 0}px`;
      }
      this.scheduleSave();
    });

    // Apply collapsed state
    if (card.collapsed) {
      el.addClass('is-collapsed');
      el.style.height = '';
    }

    const itemsEl = el.createDiv('icon-board-kanban-items');
    for (const item of card.items) {
      this.appendKanbanItem(itemsEl, card, item);
    }

    itemsEl.addEventListener('dragenter', (e) => {
      if (this.isDropAccepted(e)) { e.preventDefault(); itemsEl.addClass('is-drag-over'); }
    });
    itemsEl.addEventListener('dragleave', (e) => {
      if (!itemsEl.contains(e.relatedTarget as Node)) itemsEl.removeClass('is-drag-over');
    });
    itemsEl.addEventListener('dragover', (e) => {
      if (this.isDropAccepted(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer!.dropEffect = 'copy'; }
    });
    itemsEl.addEventListener('drop', (e) => { void (async () => {
      itemsEl.removeClass('is-drag-over');
      if (!this.isDropAccepted(e)) return;
      e.preventDefault(); e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files?.length) {
        for (const f of Array.from(files)) {
          if (f.type.startsWith('image/')) await this.handleDroppedImageToKanban(f, card, itemsEl);
          else if (f.type.startsWith('audio/')) await this.handleDroppedAudioToKanban(f, card, itemsEl);
        }
        return;
      }
      const dragMgr = (this.app as AppWithPrivateAPIs).dragManager;
      const draggable = dragMgr?.draggable;
      if (draggable?.type === 'file' && draggable.file instanceof TFile) {
        const vf = draggable.file;
        const ext = vf.extension.toLowerCase();
        if (IMAGE_EXTS.includes(ext)) {
          const newPath = await sortAssetFile(this.app, vf);
          this.addKanbanImageItem(newPath, card, itemsEl);
        } else if (AUDIO_EXTS.includes(ext)) {
          const newPath = await sortAssetFile(this.app, vf);
          this.addKanbanAudioItem(newPath, card, itemsEl);
        }
      }
    })(); });

    const addBtn = el.createDiv('icon-board-kanban-add-btn');
    const addIcon = addBtn.createSpan();
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add item' });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addKanbanItem(card, el);
    });

    this.appendResizeHandles(el);
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
    this.pushUndo(); this.board.cards.push(card); void this.saveNow();
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

  private rebuildChecklistCard(card: ChecklistCard): void {
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
      const n = card.items.length;
      const label = card.wipLimit !== undefined ? `${n}/${card.wipLimit} cards` : `${n} ${n === 1 ? 'card' : 'cards'}`;
      countSpan.setText(label);
    }
    const countRow = cardEl.querySelector<HTMLElement>('.icon-board-kanban-count-row');
    if (overWip && !wipDot) {
      (countRow ?? cardEl.querySelector('.icon-board-kanban-header'))?.createSpan({ cls: 'icon-board-kanban-wip-dot' });
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
    const restoreTitle = (text: string | undefined) => {
      titleEl.empty();
      if (card.color) titleEl.style.color = card.color;
      if (text) {
        titleEl.removeClass('icon-board-kanban-title-empty');
        titleEl.setText(text);
      } else {
        titleEl.addClass('icon-board-kanban-title-empty');
        titleEl.setText('Untitled');
      }
    };
    const commit = () => {
      if (cancelled) { restoreTitle(original || undefined); return; }
      const val = input.value.trim();
      this.pushUndo();
      card.title = val || undefined;
      restoreTitle(card.title);
      this.scheduleSave();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; input.blur(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
    window.requestAnimationFrame(() => { input.focus(); input.select(); });
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
      itemEl.addClass('has-image');
      const imgWrap = bodyEl.createDiv('icon-board-kanban-item-image');
      const vf = this.app.vault.getAbstractFileByPath(item.imagePath);
      if (vf instanceof TFile) {
        const img = imgWrap.createEl('img');
        img.src = this.app.vault.getResourcePath(vf);
        img.alt = '';
      }
    }

    if (item.audioPath) {
      const audioWrap = bodyEl.createDiv('icon-board-kanban-item-audio');
      const vf = this.app.vault.getAbstractFileByPath(item.audioPath);
      if (vf instanceof TFile) {
        audioWrap.createDiv({ cls: 'icon-board-kanban-audio-title', text: vf.basename });
        const audio = audioWrap.createEl('audio');
        audio.src = this.app.vault.getResourcePath(vf);
        audio.controls = true;
        audio.addClass('icon-board-kanban-audio-player');
        audio.addEventListener('pointerdown', (e) => e.stopPropagation());
        audio.addEventListener('click', (e) => e.stopPropagation());
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
          void this.app.workspace.openLinkText(item.linkedNotePath!, '', false);
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
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        this.pushUndo();
        card.items = card.items.filter(i => i.id !== item.id);
        itemEl.remove();
        const cardEl = this.cardEls.get(card.id);
        if (cardEl) this.updateKanbanCount(card, cardEl);
        this.scheduleSave();
      }
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
          activeDocument.removeEventListener('pointermove', onMove);
          activeDocument.removeEventListener('pointerup', onUp);
          this.startItemDrag(startE, card, item, itemEl, itemsEl);
        }
      };
      const onUp = () => {
        activeDocument.removeEventListener('pointermove', onMove);
        activeDocument.removeEventListener('pointerup', onUp);
        if (!wasDragged) itemEl.focus();
      };
      activeDocument.addEventListener('pointermove', onMove);
      activeDocument.addEventListener('pointerup', onUp);
    });

    itemEl.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.icon-board-kanban-item-cb') || target.closest('.icon-board-kanban-item-del')) return;
      e.stopPropagation();
      if (!item.imagePath && !item.audioPath) this.editKanbanItemInline(card, item, itemEl);
    });

    itemEl.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const menu = new Menu();
      if (item.linkedNotePath) {
        menu.addItem(i => i.setTitle('Open linked note').setIcon('file-text').onClick(() => {
          void this.app.workspace.openLinkText(item.linkedNotePath!, '', false);
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
      menu.addItem(i => i.setTitle('Attach audio…').setIcon('music').onClick(() => {
        new VaultAudioPickerModal(this.app, (file) => {
          this.pushUndo(); item.audioPath = file.path;
          this.rebuildKanbanCard(card); this.scheduleSave();
        }).open();
      }));
      if (item.audioPath) {
        menu.addItem(i => i.setTitle('Remove audio').setIcon('x').onClick(() => {
          this.pushUndo(); item.audioPath = undefined;
          this.rebuildKanbanCard(card); this.scheduleSave();
        }));
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
    const textEl = itemEl.querySelector<HTMLElement>('.icon-board-kanban-item-text');
    const bodyEl = itemEl.querySelector<HTMLElement>('.icon-board-kanban-item-body');
    if (!textEl || !bodyEl || bodyEl.querySelector('.icon-board-kanban-item-editor')) return;

    const original = item.text;
    const seedHTML = textEl.innerHTML;
    textEl.hide();
    itemEl.addClass('is-editing');

    const editor = bodyEl.createDiv('icon-board-kanban-item-editor') as HTMLElement;
    editor.contentEditable = 'true';
    editor.empty();
    if (item.text) editor.appendChild(sanitizeHTMLToDom(seedHTML));
    editor.addEventListener('pointerdown', e => e.stopPropagation());

    const fmtToolbar = new TextFormatToolbar(editor, itemEl, this.container);

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      itemEl.removeClass('is-editing');
      fmtToolbar.destroy();
      const html = editor.innerHTML;
      editor.remove(); textEl.show();
      const isEmpty = !html || html === '<br>' || !html.trim();
      if (isEmpty) {
        this.pushUndo();
        card.items = card.items.filter(i => i.id !== item.id);
        itemEl.remove();
        const cardEl = this.cardEls.get(card.id);
        if (cardEl) this.updateKanbanCount(card, cardEl);
        this.scheduleSave();
        return;
      }
      this.pushUndo();
      item.text = html;
      textEl.empty();
      MarkdownRenderer.render(this.app, html, textEl, '', this).catch(() => textEl.setText(html));
      this.scheduleSave();
    };

    editor.addEventListener('blur', commit);
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editor.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        committed = true;
        fmtToolbar.destroy();
        editor.removeEventListener('blur', commit);
        editor.remove(); textEl.show();
        itemEl.removeClass('is-editing');
        if (!original) {
          card.items = card.items.filter(i => i.id !== item.id);
          itemEl.remove();
          const cardEl = this.cardEls.get(card.id);
          if (cardEl) this.updateKanbanCount(card, cardEl);
        } else {
          textEl.empty();
          MarkdownRenderer.render(this.app, original, textEl, '', this).catch(() => textEl.setText(original));
        }
      }
    });

    window.requestAnimationFrame(() => {
      editor.focus();
      const r = activeDocument.createRange();
      r.selectNodeContents(editor); r.collapse(false);
      const s = window.getSelection();
      s?.removeAllRanges(); s?.addRange(r);
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

    const ghost = activeDocument.createElement('div');
    ghost.className = 'icon-board-kanban-drag-ghost';
    ghost.textContent = item.text || '…';
    ghost.style.width = `${itemRect.width}px`;
    ghost.style.left = `${itemRect.left}px`;
    ghost.style.top = `${itemRect.top}px`;
    ghost.addClass('ib-no-pointer');
    activeDocument.body.appendChild(ghost);

    itemEl.addClass('is-dragging');

    let dropIndicator: HTMLElement | null = null;
    let targetCard: KanbanColumnCard | null = null;
    let insertBeforeItemId: string | null = null;
    let lastPointer = { x: startEvent.clientX, y: startEvent.clientY };

    const removeIndicator = () => { dropIndicator?.remove(); dropIndicator = null; };

    const onMove = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      ghost.style.left = `${itemRect.left + (e.clientX - startEvent.clientX)}px`;
      ghost.style.top = `${itemRect.top + (e.clientY - startEvent.clientY)}px`;
      removeIndicator();
      targetCard = null;
      insertBeforeItemId = null;

      const els = activeDocument.elementsFromPoint(e.clientX, e.clientY);
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
      dropIndicator = activeDocument.createElement('div');
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
      activeDocument.removeEventListener('pointermove', onMove);
      activeDocument.removeEventListener('pointerup', onUp);
      ghost.remove();
      removeIndicator();
      itemEl.removeClass('is-dragging');

      if (!targetCard) {
        // Drop onto canvas: eject image or audio items back as canvas cards
        if (item.imagePath || item.audioPath) {
          const outerRect = this.outer.getBoundingClientRect();
          const overCanvas = lastPointer.x >= outerRect.left && lastPointer.x <= outerRect.right &&
                             lastPointer.y >= outerRect.top  && lastPointer.y <= outerRect.bottom;
          if (overCanvas) {
            const cp = screenToCanvas(lastPointer.x - outerRect.left, lastPointer.y - outerRect.top, this.vp);
            this.pushUndo();
            sourceCard.items = sourceCard.items.filter(i => i.id !== item.id);
            this.rebuildKanbanCard(sourceCard);
            if (item.imagePath) {
              const c: ImageCard = { id: crypto.randomUUID(), kind: 'image',
                x: snap(cp.x - IMAGE_DEFAULT_W / 2), y: snap(cp.y - IMAGE_DEFAULT_H / 2),
                w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, z: this.nextZ(),
                source: { type: 'vault', path: item.imagePath } };
              this.board.cards.push(c); this.createCardEl(c);
              this.selection.select(c.id); this.refreshSelectionVisuals();
            } else if (item.audioPath) {
              const c: AudioCard = { id: crypto.randomUUID(), kind: 'audio',
                x: snap(cp.x - AUDIO_DEFAULT_W / 2), y: snap(cp.y - AUDIO_DEFAULT_H / 2),
                w: AUDIO_DEFAULT_W, h: AUDIO_DEFAULT_H, z: this.nextZ(),
                source: { type: 'vault', path: item.audioPath } };
              this.board.cards.push(c); this.createCardEl(c);
              this.selection.select(c.id); this.refreshSelectionVisuals();
            }
            this.scheduleSave();
          }
        }
        return;
      }
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

    activeDocument.addEventListener('pointermove', onMove);
    activeDocument.addEventListener('pointerup', onUp);
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
      const favEl = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
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
    this.alignBarEl?.toggleClass('is-visible', this.selection.getIds().length > 1);

    const ids = this.selection.getIds();
    if (ids.length === 1) {
      const card = this.board.cards.find(c => c.id === ids[0]);
      if (card) this.contextBar?.show(card as SupportedCard);
      else this.contextBar?.hide();
    } else {
      this.contextBar?.hide();
    }
  }

  // ── Card events ────────────────────────────────────────────────

  private bindCardEvents(el: HTMLElement, card: SupportedCard): void {
    let dragMoved = false;

    el.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('icon-board-card-resize-handle')) return;
      if (target.classList.contains('icon-board-connection-handle')) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
      if (target.closest('[contenteditable="true"]')) return;
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

      let hoveredKanban: KanbanColumnCard | null = null;

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
        if ((card.kind === 'image' || card.kind === 'audio') && startPos.size === 1) {
          const elRect = el.getBoundingClientRect();
          let found: KanbanColumnCard | null = null;
          for (const kc of this.board.cards) {
            if (kc.kind !== 'kanban-column') continue;
            const kEl = this.cardEls.get(kc.id);
            if (!kEl) continue;
            const kr = kEl.getBoundingClientRect();
            if (elRect.left < kr.right && elRect.right > kr.left && elRect.top < kr.bottom && elRect.bottom > kr.top) {
              found = kc; break;
            }
          }
          if (found !== hoveredKanban) {
            if (hoveredKanban) this.cardEls.get(hoveredKanban.id)?.removeClass('is-kanban-drop-target');
            hoveredKanban = found;
            if (found) this.cardEls.get(found.id)?.addClass('is-kanban-drop-target');
          }
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
        if (hoveredKanban) this.cardEls.get(hoveredKanban.id)?.removeClass('is-kanban-drop-target');
        if (dragMoved && hoveredKanban && (card.kind === 'image' || card.kind === 'audio')) {
          const targetCard = hoveredKanban;
          const kEl = this.cardEls.get(targetCard.id);
          const itemsEl = kEl?.querySelector<HTMLElement>('.icon-board-kanban-items');
          if (itemsEl && card.source.type === 'vault') {
            const path = card.source.path;
            const item: KanbanItem = card.kind === 'image'
              ? { id: crypto.randomUUID(), text: '', imagePath: path }
              : { id: crypto.randomUUID(), text: '', audioPath: path };
            targetCard.items.push(item);
            this.appendKanbanItem(itemsEl, targetCard, item);
            if (kEl) this.updateKanbanCount(targetCard, kEl);
            this.board.cards = this.board.cards.filter(c => c.id !== card.id);
            el.remove(); this.cardEls.delete(card.id);
            this.refreshSelectionVisuals();
          }
          this.scheduleSave();
          return;
        }
        if (dragMoved) this.scheduleSave();
      };
      el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
    });

    el.addEventListener('dblclick', (e) => { void (async () => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      switch (card.kind) {
        case 'tile':      await this.activateTile(card); break;
        case 'sticky':    this.editStickyInline(el, card); break;
        case 'note-link': await this.activateNoteLink(card); break;
        case 'image':
          if (target.closest('.icon-board-image-caption-wrap')) break;
          this.openImageSource(card); break;
        case 'bookmark':  window.open(card.url, '_blank'); break;
      }
    })(); });

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
        new TileModal(this.app, card, (updated) => {
          const idx = this.board.cards.findIndex(c => c.id === updated.id);
          if (idx !== -1) {
            this.board.cards[idx] = updated; this.cardEls.delete(card.id);
            this.renderCardContent(el, updated); this.bindCardEvents(el, updated);
            this.cardEls.set(updated.id, el); void this.saveNow();
          }
        }, this.file).open();
      }));
    }

    if (card.kind === 'sticky') {
      menu.addItem(i => i.setTitle('Edit text').setIcon('pencil').onClick(() => this.editStickyInline(el, card)));
    }

    if (card.kind === 'checklist') {
      menu.addItem(i => i.setTitle('Add section header').setIcon('heading').onClick(() => {
        const listEl = el.querySelector<HTMLElement>('.icon-board-checklist-list');
        if (!listEl) return;
        this.pushUndo();
        const newItem: ChecklistItem = { id: crypto.randomUUID(), text: '', done: false, isHeader: true };
        card.items.push(newItem);
        const row = this.appendChecklistItem(listEl, card, newItem);
        listEl.appendChild(row);
        window.setTimeout(() => row.querySelector<HTMLElement>('.icon-board-checklist-item-input')?.focus(), 0);
        this.scheduleSave();
      }));
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Change accent colour…').setIcon('palette').onClick(() => {
        this.showAccentColorPopover(el, card);
      }));
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
      menu.addItem(i => i
        .setTitle(card.captionHidden ? 'Show caption' : 'Hide caption')
        .setIcon('type')
        .onClick(() => {
          this.pushUndo(); card.captionHidden = !card.captionHidden;
          const wrap = el.querySelector<HTMLElement>('.icon-board-image-caption-wrap');
          if (wrap) wrap.toggleClass('is-hidden', !!card.captionHidden);
          this.scheduleSave();
        }));
      menu.addSeparator();
      const applyCapStyle = () => {
        const view = el.querySelector<HTMLElement>('.icon-board-image-caption-view');
        const ta = el.querySelector<HTMLElement>('.icon-board-image-caption');
        [view, ta].forEach(n => {
          if (!n) return;
          n.className = n.className.replace(/\btext-scale-\S+/g, '').trim();
          if (card.captionScale) n.classList.add(`text-scale-${card.captionScale}`);
          n.style.color = card.captionColor ?? '';
        });
        this.scheduleSave();
      };
      menu.addItem(i => i.setTitle('Caption size: Small').setChecked(card.captionScale === 'sm').onClick(() => {
        this.pushUndo(); card.captionScale = 'sm'; applyCapStyle();
      }));
      menu.addItem(i => i.setTitle('Caption size: Medium').setChecked(!card.captionScale || card.captionScale === 'md').onClick(() => {
        this.pushUndo(); card.captionScale = 'md'; applyCapStyle();
      }));
      menu.addItem(i => i.setTitle('Caption size: Large').setChecked(card.captionScale === 'lg').onClick(() => {
        this.pushUndo(); card.captionScale = 'lg'; applyCapStyle();
      }));
      const CAPTION_COLORS = [
        { color: '', name: 'Default' },
        { color: '#dc2626', name: 'Red' },
        { color: '#d97706', name: 'Amber' },
        { color: '#16a34a', name: 'Green' },
        { color: '#2563eb', name: 'Blue' },
        { color: '#7c3aed', name: 'Purple' },
        { color: '#6b7280', name: 'Grey' },
      ];
      for (const { color, name } of CAPTION_COLORS) {
        menu.addItem(i => i.setTitle(`Caption: ${name}`).setChecked(card.captionColor === color || (!card.captionColor && !color)).onClick(() => {
          this.pushUndo(); card.captionColor = color || undefined; applyCapStyle();
        }));
      }
    }

    if (card.kind === 'audio') {
      menu.addItem(i => i.setTitle('Choose from vault…').setIcon('folder-open').onClick(() => {
        new VaultAudioPickerModal(this.app, (file) => {
          this.pushUndo(); card.source = { type: 'vault', path: file.path };
          this.renderCardContent(el, card); this.bindCardEvents(el, card); this.scheduleSave();
        }).open();
      }));
    }

    if (card.kind === 'bookmark') {
      menu.addItem(i => i.setTitle('Refresh preview').setIcon('refresh-cw').onClick(() => {
        card.fetchFailed = false; card.fetchedAt = undefined;
        this.renderCardContent(el, card); this.bindCardEvents(el, card);
        void this.fetchAndUpdateBookmark(card, el);
      }));
      menu.addItem(i => i.setTitle('Copy URL').setIcon('copy').onClick(() => {
        void navigator.clipboard.writeText(card.url); new Notice('URL copied.');
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

    const selIds = this.selection.getIds();
    if (selIds.length > 1) {
      menu.addSeparator();
      menu.addItem(i => i.setTitle('Align left').setIcon('align-left').onClick(() => this.alignCards('left')));
      menu.addItem(i => i.setTitle('Align center').setIcon('align-center').onClick(() => this.alignCards('center-h')));
      menu.addItem(i => i.setTitle('Align right').setIcon('align-right').onClick(() => this.alignCards('right')));
      menu.addItem(i => i.setTitle('Align top').setIcon('align-start-vertical').onClick(() => this.alignCards('top')));
      menu.addItem(i => i.setTitle('Align middle').setIcon('align-center-vertical').onClick(() => this.alignCards('middle-v')));
      menu.addItem(i => i.setTitle('Align bottom').setIcon('align-end-vertical').onClick(() => this.alignCards('bottom')));
      menu.addItem(i => i.setTitle('Distribute horizontally').setIcon('arrows-left-right').onClick(() => this.alignCards('distribute-h')));
      menu.addItem(i => i.setTitle('Distribute vertically').setIcon('arrows-up-down').onClick(() => this.alignCards('distribute-v')));
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

  private appendResizeHandles(el: HTMLElement): void {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const)
      el.createDiv(`icon-board-card-resize-handle icon-board-card-resize-handle--${corner}`);
  }

  private bindResizeHandle(el: HTMLElement, card: SupportedCard): void {
    const handles = el.querySelectorAll<HTMLElement>('.icon-board-card-resize-handle');
    handles.forEach(handle => {
      const corner = (['nw','ne','sw','se'] as const).find(c => handle.classList.contains(`icon-board-card-resize-handle--${c}`)) ?? 'se';

      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); this.pushUndo();
        const sc = { x: e.clientX, y: e.clientY };
        const startX = card.x ?? 0, startY = card.y ?? 0;
        const startW = card.w ?? TILE_DEFAULT_W, startH = card.h ?? TILE_DEFAULT_H;
        const { w: minW, h: minH } = cardMinSize(card.kind);
        el.setPointerCapture(e.pointerId);

        let imgAspect: number | null = null;
        if (card.kind === 'image') {
          const imgEl = el.querySelector<HTMLImageElement>('.icon-board-image-img');
          imgAspect = (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0)
            ? imgEl.naturalHeight / imgEl.naturalWidth
            : startH / startW;
        }

        const onMove = (ev: PointerEvent) => {
          const cdx = (ev.clientX - sc.x) / this.vp.zoom;
          const cdy = (ev.clientY - sc.y) / this.vp.zoom;
          const wSign = (corner === 'se' || corner === 'ne') ? 1 : -1;
          const hSign = (corner === 'se' || corner === 'sw') ? 1 : -1;
          const newW = Math.max(minW, snap(startW + wSign * cdx));

          if (card.kind === 'sticky') {
            card.w = newW;
            if (corner === 'sw' || corner === 'nw') card.x = snap(startX + startW - newW);
            el.style.width = `${card.w}px`;
            el.style.left = `${card.x ?? startX}px`;
          } else if (imgAspect !== null) {
            card.w = newW;
            card.h = Math.max(minH, snap(newW * imgAspect));
            if (corner === 'sw' || corner === 'nw') card.x = snap(startX + startW - card.w);
            if (corner === 'nw' || corner === 'ne') card.y = snap(startY + startH - card.h);
            el.style.width = `${card.w}px`; el.style.height = `${card.h}px`;
            el.style.left = `${card.x ?? startX}px`; el.style.top = `${card.y ?? startY}px`;
          } else {
            card.w = newW;
            card.h = Math.max(minH, snap(startH + hSign * cdy));
            if (corner === 'sw' || corner === 'nw') card.x = snap(startX + startW - card.w);
            if (corner === 'nw' || corner === 'ne') card.y = snap(startY + startH - card.h);
            el.style.width = `${card.w}px`; el.style.height = `${card.h}px`;
            el.style.left = `${card.x ?? startX}px`; el.style.top = `${card.y ?? startY}px`;
          }

          if (card.kind === 'tile') {
            const tileSize = Math.max(40, Math.min(card.w - 20, card.h - 50 - 16));
            const sq = el.querySelector<HTMLElement>('.icon-board-freeform-tile-square');
            const ic = el.querySelector<HTMLElement>('.icon-board-tile-icon');
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
    });
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    const active = activeDocument.activeElement;
    const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      || (active instanceof HTMLElement && active.getAttribute('contenteditable') != null);
    if (isTyping) return;

    const meta = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (this.pendingTool) { this.clearPendingTool(); return; }
      if (this.overflowPopover) { this.closeOverflow(); return; }
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
    if (meta && e.shiftKey && e.key.toLowerCase() === 'c') {
      const imageCards = this.selection.getIds()
        .map(id => this.board.cards.find(c => c.id === id))
        .filter((c): c is ImageCard => !!c && c.kind === 'image');
      if (imageCards.length > 0) {
        e.preventDefault();
        this.pushUndo();
        for (const card of imageCards) {
          card.captionHidden = !card.captionHidden;
          const cardEl = this.cardEls.get(card.id);
          if (cardEl) {
            const wrap = cardEl.querySelector<HTMLElement>('.icon-board-image-caption-wrap');
            if (wrap) wrap.toggleClass('is-hidden', !!card.captionHidden);
          }
        }
        this.scheduleSave();
        return;
      }
    }
  }

  // ── Activation ─────────────────────────────────────────────────

  private async activateTile(tile: TileCard): Promise<void> {
    const { target } = tile;
    if (!target.path) { new Notice('This tile has no target set.'); return; }
    if (target.kind === 'board') { await this.onNavigate(target.path); return; }
    const file = this.app.vault.getAbstractFileByPath(target.path);
    if (!file) { new Notice(`Target no longer exists: ${target.path}`); return; }
    if (target.kind === 'note' || target.kind === 'canvas') {
      if (!(file instanceof TFile)) return;
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file); void this.app.workspace.revealLeaf(leaf); return;
    }

    if (target.kind === 'kanban') {
      if (!(file instanceof TFile)) return;
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file); void this.app.workspace.revealLeaf(leaf);
      const isInstalled = (this.app as AppWithPrivateAPIs).plugins?.enabledPlugins?.has('obsidian-kanban') ?? false;
      if (!isInstalled) new Notice('Install the community "Kanban" plugin to view this as a board.');
      return;
    }
    if (target.kind === 'folder') {
      if (!(file instanceof TFolder)) return;
      const ex = this.app.workspace.getLeavesOfType('file-explorer');
      if (ex.length > 0) { const v = ex[0].view as { revealInFolder?: (f: TFolder) => void }; v.revealInFolder?.(file); }
      const firstNote = file.children?.find((f): f is TFile => f instanceof TFile && f.extension === 'md');
      if (firstNote) { const leaf = this.app.workspace.getLeaf('tab'); await leaf.openFile(firstNote); void this.app.workspace.revealLeaf(leaf); }
    }
  }

  private async activateNoteLink(card: NoteLinkCard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.path);
    if (!(file instanceof TFile)) { new Notice(`Note no longer exists: ${card.path}`); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file); void this.app.workspace.revealLeaf(leaf);
  }

  private openImageSource(card: ImageCard): void {
    if (card.source.type === 'vault') {
      const file = this.app.vault.getAbstractFileByPath(card.source.path);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf('tab');
        void leaf.openFile(file); void this.app.workspace.revealLeaf(leaf);
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
    new TileModal(this.app, null, (t) => {
      t.x = x; t.y = y; t.w = TILE_DEFAULT_W; t.h = TILE_DEFAULT_H; t.z = this.nextZ();
      this.pushUndo(); this.board.cards.push(t); void this.saveNow();
      this.createCardEl(t); this.selection.select(t.id); this.refreshSelectionVisuals();
    }, this.file).open();
  }

  private addSticky(): void { const p = this.centerPos(STICKY_DEFAULT_W, STICKY_DEFAULT_H); this.addStickyAt(p.x, p.y); }
  private addStickyAt(x: number, y: number, initialText = ''): void {
    const card: StickyCard = { id: crypto.randomUUID(), kind: 'sticky', x, y, w: STICKY_DEFAULT_W, z: this.nextZ(), text: initialText, color: this.defaultStickyColor ?? STICKY_COLORS[0].color };
    this.pushUndo(); this.board.cards.push(card); void this.saveNow();
    const el = this.createCardEl(card);
    this.selection.select(card.id); this.refreshSelectionVisuals();
    if (!initialText) this.editStickyInline(el, card);
  }

  private addChecklist(): void { const p = this.centerPos(CHECKLIST_DEFAULT_W, CHECKLIST_DEFAULT_H); this.addChecklistAt(p.x, p.y); }
  private addChecklistAt(x: number, y: number): void {
    const card: ChecklistCard = { id: crypto.randomUUID(), kind: 'checklist', x, y, w: CHECKLIST_DEFAULT_W, h: CHECKLIST_DEFAULT_H, z: this.nextZ(), title: '', accentColor: '#EF4444', items: [], color: 'var(--background-primary)' };
    this.pushUndo(); this.board.cards.push(card); void this.saveNow();
    const el = this.createCardEl(card);
    this.selection.select(card.id); this.refreshSelectionVisuals();
    window.setTimeout(() => el.querySelector<HTMLElement>('.icon-board-checklist-title')?.focus(), 50);
  }

  private addNoteLink(): void { const p = this.centerPos(NOTELINK_DEFAULT_W, NOTELINK_DEFAULT_H); this.addNoteLinkAt(p.x, p.y); }
  private addNoteLinkAt(x: number, y: number): void {
    new NoteLinkPickerModal(this.app, (file) => {
      const card: NoteLinkCard = { id: crypto.randomUUID(), kind: 'note-link', x, y, w: NOTELINK_DEFAULT_W, h: NOTELINK_DEFAULT_H, z: this.nextZ(), path: file.path, displayMode: 'preview' };
      this.pushUndo(); this.board.cards.push(card); void this.saveNow();
      this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
    }).open();
  }

  private addImage(): void { const p = this.centerPos(IMAGE_DEFAULT_W, IMAGE_DEFAULT_H); this.addImageAt(p.x, p.y); }
  private addImageAt(x: number, y: number): void {
    const createCard = (path: string, h: number) => {
      const card: ImageCard = { id: crypto.randomUUID(), kind: 'image', x, y, w: IMAGE_DEFAULT_W, h, z: this.nextZ(), source: { type: 'vault', path }, captionHidden: true };
      this.pushUndo(); this.board.cards.push(card); void this.saveNow();
      this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
    };
    const fromVault = () => new VaultImagePickerModal(this.app, (f) => { void (async () => {
      const newPath = await sortAssetFile(this.app, f);
      const newFile = this.app.vault.getAbstractFileByPath(newPath);
      if (!(newFile instanceof TFile)) return;
      const h = await this.measureImageH(this.app.vault.getResourcePath(newFile));
      createCard(newPath, h);
    })(); }).open();
    const fromUpload = () => {
      const input = activeDocument.createElement('input');
      input.type = 'file'; input.accept = IMAGE_EXTS.map(e => `.${e}`).join(',');
      input.addEventListener('change', () => { void (async () => {
        const file = input.files?.[0]; if (!file) return;
        const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : file.type.includes('webp') ? 'webp' : 'jpg';
        const base = file.name.replace(/\.[^.]+$/, '');
        let path: string;
        try { path = await saveNewAsset(this.app, await file.arrayBuffer(), `${base}.${ext}`); }
        catch { new Notice(`Failed to save ${file.name}.`); return; }
        const h = await this.measureImageH(file);
        createCard(path, h);
      })(); });
      input.click();
    };
    new MediaSourceModal(this.app, 'Add image', fromVault, fromUpload).open();
  }

  private addAudio(): void { const p = this.centerPos(AUDIO_DEFAULT_W, AUDIO_DEFAULT_H); this.addAudioAt(p.x, p.y); }
  private addAudioAt(x: number, y: number): void {
    const createCard = (path: string) => {
      const card: AudioCard = { id: crypto.randomUUID(), kind: 'audio', x, y, w: AUDIO_DEFAULT_W, h: AUDIO_DEFAULT_H, z: this.nextZ(), source: { type: 'vault', path } };
      this.pushUndo(); this.board.cards.push(card); void this.saveNow();
      this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
    };
    const fromVault = () => new VaultAudioPickerModal(this.app, (f) => { void (async () => {
      const newPath = await sortAssetFile(this.app, f);
      createCard(newPath);
    })(); }).open();
    const fromUpload = () => {
      const input = activeDocument.createElement('input');
      input.type = 'file'; input.accept = AUDIO_EXTS.map(e => `.${e}`).join(',');
      input.addEventListener('change', () => { void (async () => {
        const file = input.files?.[0]; if (!file) return;
        const ext = file.name.toLowerCase().endsWith('.mp3') ? 'mp3' : file.name.toLowerCase().endsWith('.ogg') ? 'ogg' : 'wav';
        const base = file.name.replace(/\.[^.]+$/, '');
        let path: string;
        try { path = await saveNewAsset(this.app, await file.arrayBuffer(), `${base}.${ext}`); }
        catch { new Notice(`Failed to save ${file.name}.`); return; }
        createCard(path);
      })(); });
      input.click();
    };
    new MediaSourceModal(this.app, 'Add audio', fromVault, fromUpload).open();
  }

  private addBookmark(): void { const p = this.centerPos(BOOKMARK_DEFAULT_W, BOOKMARK_DEFAULT_H); this.addBookmarkAt(p.x, p.y); }
  private addBookmarkAt(x: number, y: number, url?: string): void {
    if (url) { this.createBookmarkCard(x, y, url); return; }
    new BookmarkInputModal(this.app, (u) => this.createBookmarkCard(x, y, u)).open();
  }

  private createBookmarkCard(x: number, y: number, url: string): void {
    const card: BookmarkCard = { id: crypto.randomUUID(), kind: 'bookmark', x, y, w: BOOKMARK_DEFAULT_W, h: BOOKMARK_DEFAULT_H, z: this.nextZ(), url };
    this.pushUndo(); this.board.cards.push(card); void this.saveNow();
    const el = this.createCardEl(card);
    this.selection.select(card.id); this.refreshSelectionVisuals();
    void this.fetchAndUpdateBookmark(card, el);
  }

  // ── Image helpers ──────────────────────────────────────────────

  private measureImageH(fileOrSrc: File | string): Promise<number> {
    let src: string;
    let revoke = false;
    if (typeof fileOrSrc !== 'string') {
      src = URL.createObjectURL(fileOrSrc); revoke = true;
    } else { src = fileOrSrc; }
    return new Promise<number>((resolve) => {
      const img = new Image();
      const done = (ok: boolean) => {
        if (revoke) URL.revokeObjectURL(src);
        resolve(ok && img.naturalWidth > 0
          ? Math.max(IMAGE_MIN_H, snap(IMAGE_DEFAULT_W * img.naturalHeight / img.naturalWidth))
          : IMAGE_DEFAULT_H);
      };
      img.onload  = () => done(true);
      img.onerror = () => done(false);
      img.src = src;
    });
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      try { await this.app.vault.createFolder(path); } catch { /* ignore */ }
    }
  }

  private async handlePastedImage(file: File): Promise<void> {
    const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : 'jpg';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `Pasted Image ${ts}.${ext}`;
    let path: string;
    try { path = await saveNewAsset(this.app, await file.arrayBuffer(), filename); }
    catch { new Notice('Failed to save pasted image.'); return; }
    const pastedFile = this.app.vault.getAbstractFileByPath(path);
    if (!(pastedFile instanceof TFile)) return;
    const h = await this.measureImageH(this.app.vault.getResourcePath(pastedFile));
    const { x, y } = this.centerPos(IMAGE_DEFAULT_W, h);
    const card: ImageCard = { id: crypto.randomUUID(), kind: 'image', x, y, w: IMAGE_DEFAULT_W, h, z: this.nextZ(), source: { type: 'vault', path }, captionHidden: true };
    this.pushUndo(); this.board.cards.push(card); await this.saveNow();
    this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
  }

  private async handleDroppedImage(file: File, x: number, y: number): Promise<void> {
    const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : file.type.includes('webp') ? 'webp' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '');
    let path: string;
    try { path = await saveNewAsset(this.app, await file.arrayBuffer(), `${base}.${ext}`); }
    catch { new Notice(`Failed to save ${file.name}.`); return; }
    const h = await this.measureImageH(file);
    const card: ImageCard = { id: crypto.randomUUID(), kind: 'image', x, y, w: IMAGE_DEFAULT_W, h, z: this.nextZ(), source: { type: 'vault', path }, captionHidden: true };
    this.pushUndo(); this.board.cards.push(card); await this.saveNow();
    this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
  }

  private async handleDroppedImageToKanban(file: File, card: KanbanColumnCard, itemsEl: HTMLElement): Promise<void> {
    const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : file.type.includes('webp') ? 'webp' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '');
    let path: string;
    try { path = await saveNewAsset(this.app, await file.arrayBuffer(), `${base}.${ext}`); }
    catch { new Notice(`Failed to save ${file.name}.`); return; }
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

  private async handleDroppedAudioToKanban(file: File, card: KanbanColumnCard, itemsEl: HTMLElement): Promise<void> {
    const ext = file.name.toLowerCase().endsWith('.mp3') ? 'mp3' : file.name.toLowerCase().endsWith('.ogg') ? 'ogg' : 'wav';
    const base = file.name.replace(/\.[^.]+$/, '');
    let path: string;
    try { path = await saveNewAsset(this.app, await file.arrayBuffer(), `${base}.${ext}`); }
    catch { new Notice(`Failed to save ${file.name}.`); return; }
    this.addKanbanAudioItem(path, card, itemsEl);
  }

  private addKanbanAudioItem(audioPath: string, card: KanbanColumnCard, itemsEl: HTMLElement): void {
    this.pushUndo();
    const item: KanbanItem = { id: crypto.randomUUID(), text: '', audioPath };
    card.items.push(item);
    this.appendKanbanItem(itemsEl, card, item);
    const cardEl = this.cardEls.get(card.id);
    if (cardEl) this.updateKanbanCount(card, cardEl);
    this.scheduleSave();
  }

  private isDropAccepted(e: DragEvent): boolean {
    if (e.dataTransfer?.types.includes('Files')) return true;
    const dragMgr = (this.app as AppWithPrivateAPIs).dragManager;
    const draggable = dragMgr?.draggable;
    if (draggable?.type !== 'file' || !(draggable.file instanceof TFile)) return false;
    const ext = draggable.file.extension.toLowerCase();
    return IMAGE_EXTS.includes(ext) || AUDIO_EXTS.includes(ext);
  }

  private async handleDroppedAudio(file: File, x: number, y: number): Promise<void> {
    const ext = file.name.toLowerCase().endsWith('.mp3') ? 'mp3' : file.name.toLowerCase().endsWith('.ogg') ? 'ogg' : 'wav';
    const base = file.name.replace(/\.[^.]+$/, '');
    let path: string;
    try { path = await saveNewAsset(this.app, await file.arrayBuffer(), `${base}.${ext}`); }
    catch { new Notice(`Failed to save ${file.name}.`); return; }
    const card: AudioCard = { id: crypto.randomUUID(), kind: 'audio', x, y, w: AUDIO_DEFAULT_W, h: AUDIO_DEFAULT_H, z: this.nextZ(), source: { type: 'vault', path } };
    this.pushUndo(); this.board.cards.push(card); await this.saveNow();
    this.createCardEl(card); this.selection.select(card.id); this.refreshSelectionVisuals();
  }

  private alignCards(mode: 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom' | 'distribute-h' | 'distribute-v'): void {
    const ids = this.selection.getIds();
    const cards = ids.map(id => this.board.cards.find(c => c.id === id)).filter((c): c is Card => !!c);
    if (cards.length < 2) return;
    this.pushUndo();
    if (mode === 'left') {
      const ref = Math.min(...cards.map(c => c.x ?? 0));
      for (const c of cards) c.x = ref;
    } else if (mode === 'center-h') {
      const cx = cards.reduce((s, c) => s + (c.x ?? 0) + (c.w ?? 0) / 2, 0) / cards.length;
      for (const c of cards) c.x = cx - (c.w ?? 0) / 2;
    } else if (mode === 'right') {
      const ref = Math.max(...cards.map(c => (c.x ?? 0) + (c.w ?? 0)));
      for (const c of cards) c.x = ref - (c.w ?? 0);
    } else if (mode === 'top') {
      const ref = Math.min(...cards.map(c => c.y ?? 0));
      for (const c of cards) c.y = ref;
    } else if (mode === 'middle-v') {
      const cy = cards.reduce((s, c) => s + (c.y ?? 0) + (c.h ?? 0) / 2, 0) / cards.length;
      for (const c of cards) c.y = cy - (c.h ?? 0) / 2;
    } else if (mode === 'bottom') {
      const ref = Math.max(...cards.map(c => (c.y ?? 0) + (c.h ?? 0)));
      for (const c of cards) c.y = ref - (c.h ?? 0);
    } else if (mode === 'distribute-h') {
      const sorted = [...cards].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      const left = sorted[0].x ?? 0;
      const right = (sorted[sorted.length - 1].x ?? 0) + (sorted[sorted.length - 1].w ?? 0);
      const totalW = cards.reduce((s, c) => s + (c.w ?? 0), 0);
      const gap = (right - left - totalW) / (cards.length - 1);
      let x = left;
      for (const c of sorted) { c.x = x; x += (c.w ?? 0) + gap; }
    } else if (mode === 'distribute-v') {
      const sorted = [...cards].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
      const top = sorted[0].y ?? 0;
      const bottom = (sorted[sorted.length - 1].y ?? 0) + (sorted[sorted.length - 1].h ?? 0);
      const totalH = cards.reduce((s, c) => s + (c.h ?? 0), 0);
      const gap = (bottom - top - totalH) / (cards.length - 1);
      let y = top;
      for (const c of sorted) { c.y = y; y += (c.h ?? 0) + gap; }
    }
    for (const c of cards) {
      const cardEl = this.cardEls.get(c.id);
      if (cardEl) { cardEl.style.left = `${c.x}px`; cardEl.style.top = `${c.y}px`; }
    }
    this.refreshAllConnections();
    this.scheduleSave();
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
    const snap = JSON.parse(this.undoStack.pop()!) as { cards: IconBoardFile['cards']; connections: IconBoardFile['connections'] };
    this.board.cards = snap.cards; this.board.connections = snap.connections ?? [];
    this.scheduleSave(); this.rebuildCards();
  }

  private redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify({ cards: this.board.cards, connections: this.board.connections }));
    const snap = JSON.parse(this.redoStack.pop()!) as { cards: IconBoardFile['cards']; connections: IconBoardFile['connections'] };
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

  // ── Tool placement ─────────────────────────────────────────────

  private activateTool(name: string, btn: HTMLElement): void {
    if (this.pendingTool === name) { this.clearPendingTool(); return; }
    this.clearPendingTool();
    this.pendingTool = name;
    this.pendingToolBtn = btn;
    btn.addClass('is-active');
    this.setCursor('crosshair');
  }

  private clearPendingTool(): void {
    this.pendingToolBtn?.removeClass('is-active');
    this.pendingTool = null;
    this.pendingToolBtn = null;
    if (!this.connectMode) this.setCursor('');
  }

  private placePendingTool(cx: number, cy: number): void {
    const tool = this.pendingTool;
    this.clearPendingTool();
    this.closeOverflow();
    if (!tool) return;
    const s = snap;
    switch (tool) {
      case 'sticky':
        this.addStickyAt(s(cx - STICKY_DEFAULT_W / 2), s(cy - STICKY_DEFAULT_H / 2)); break;
      case 'checklist':
        this.addChecklistAt(s(cx - CHECKLIST_DEFAULT_W / 2), s(cy - CHECKLIST_DEFAULT_H / 2)); break;
      case 'kanban':
        this.addKanbanAt(s(cx - KANBAN_DEFAULT_W / 2), s(cy - KANBAN_DEFAULT_H / 2)); break;
      case 'image':
        this.addImageAt(s(cx - IMAGE_DEFAULT_W / 2), s(cy - IMAGE_DEFAULT_H / 2)); break;
      case 'audio':
        this.addAudioAt(s(cx - AUDIO_DEFAULT_W / 2), s(cy - AUDIO_DEFAULT_H / 2)); break;
      case 'bookmark':
        this.addBookmarkAt(s(cx - BOOKMARK_DEFAULT_W / 2), s(cy - BOOKMARK_DEFAULT_H / 2)); break;
      case 'notelink':
        this.addNoteLinkAt(s(cx - NOTELINK_DEFAULT_W / 2), s(cy - NOTELINK_DEFAULT_H / 2)); break;
      case 'tile':
        this.addTileAt(s(cx - TILE_DEFAULT_W / 2), s(cy - TILE_DEFAULT_H / 2)); break;
      case 'tile-board':
        new TileModal(this.app, null, (t) => {
          t.x = s(cx - TILE_DEFAULT_W / 2); t.y = s(cy - TILE_DEFAULT_H / 2);
          t.w = TILE_DEFAULT_W; t.h = TILE_DEFAULT_H; t.z = this.nextZ();
          this.pushUndo(); this.board.cards.push(t); void this.saveNow();
          this.createCardEl(t); this.selection.select(t.id); this.refreshSelectionVisuals();
        }, this.file, 'board').open(); break;
      case 'tile-folder':
        new TileModal(this.app, null, (t) => {
          t.x = s(cx - TILE_DEFAULT_W / 2); t.y = s(cy - TILE_DEFAULT_H / 2);
          t.w = TILE_DEFAULT_W; t.h = TILE_DEFAULT_H; t.z = this.nextZ();
          this.pushUndo(); this.board.cards.push(t); void this.saveNow();
          this.createCardEl(t); this.selection.select(t.id); this.refreshSelectionVisuals();
        }, this.file, 'folder').open(); break;
      case 'tile-canvas':
        new TileModal(this.app, null, (t) => {
          t.x = s(cx - TILE_DEFAULT_W / 2); t.y = s(cy - TILE_DEFAULT_H / 2);
          t.w = TILE_DEFAULT_W; t.h = TILE_DEFAULT_H; t.z = this.nextZ();
          this.pushUndo(); this.board.cards.push(t); void this.saveNow();
          this.createCardEl(t); this.selection.select(t.id); this.refreshSelectionVisuals();
        }, this.file, 'canvas').open(); break;
      case 'tile-note':
        new TileModal(this.app, null, (t) => {
          t.x = s(cx - TILE_DEFAULT_W / 2); t.y = s(cy - TILE_DEFAULT_H / 2);
          t.w = TILE_DEFAULT_W; t.h = TILE_DEFAULT_H; t.z = this.nextZ();
          this.pushUndo(); this.board.cards.push(t); void this.saveNow();
          this.createCardEl(t); this.selection.select(t.id); this.refreshSelectionVisuals();
        }, this.file, 'note').open(); break;
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────

  private renderToolbar(): void {
    const tb = this.toolbarEl = this.container.createDiv('icon-board-freeform-toolbar');
    tb.addClass(`tb-pos-${this.toolbarPosition}`);

    // ── Add panel (slot layer shown when no card is selected) ──
    const addPanel = tb.createDiv('ib-add-panel');

    // ── Primary buttons ──
    const mkBtn = (label: string, icon: string, tool: string, onClick?: () => void): HTMLElement => {
      const btn = addPanel.createDiv('icon-board-tb-btn');
      btn.setAttribute('tabindex', '0'); btn.setAttribute('aria-label', label);
      const iconEl = btn.createDiv('icon-board-tb-btn-icon');
      setIcon(iconEl, icon);
      btn.createEl('span', { text: label, cls: 'icon-board-tb-btn-label' });
      const handler = onClick ?? (() => this.activateTool(tool, btn));
      btn.addEventListener('click', handler);
      btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });

      // ── Drag to place ──
      if (tool !== 'connect') {
        btn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          let dragging = false;
          let ghost: HTMLElement | null = null;
          const sx = e.clientX, sy = e.clientY;

          const onMove = (me: PointerEvent) => {
            if (!dragging && Math.hypot(me.clientX - sx, me.clientY - sy) > 8) {
              dragging = true;
              ghost = activeDocument.body.createDiv('ib-toolbar-drag-ghost');
              setIcon(ghost, icon);
            }
            if (ghost) { ghost.style.left = `${me.clientX}px`; ghost.style.top = `${me.clientY}px`; }
          };
          const onUp = (ue: PointerEvent) => {
            activeDocument.removeEventListener('pointermove', onMove);
            activeDocument.removeEventListener('pointerup', onUp);
            ghost?.remove(); ghost = null;
            if (!dragging) return;
            const r = this.outer.getBoundingClientRect();
            if (ue.clientX < r.left || ue.clientX > r.right || ue.clientY < r.top || ue.clientY > r.bottom) return;
            const cp = screenToCanvas(ue.clientX - r.left, ue.clientY - r.top, this.vp);
            this.clearPendingTool();
            this.pendingTool = tool;
            this.pendingToolBtn = null;
            this.placePendingTool(cp.x, cp.y);
          };
          activeDocument.addEventListener('pointermove', onMove);
          activeDocument.addEventListener('pointerup', onUp);
        });
      }

      return btn;
    };

    mkBtn('Tile',    'layout-template', 'tile-canvas');
    mkBtn('Note',    'sticky-note',  'sticky');
    mkBtn('Link',    'link',         'bookmark');
    mkBtn('To-do',   'list-checks',  'checklist');
    this.connectToolBtn = mkBtn('Line', 'arrow-up-right', 'connect', () => this.toggleConnectMode());
    mkBtn('Board',   'layout-grid',  'tile-board');
    mkBtn('Column',  'columns-3',    'kanban');

    // ── Dots toggle ──
    this.dotsToggleBtn = mkBtn('Dots', 'grid-2x2', 'dots', () => {
      this.board.dotsHidden = !this.board.dotsHidden;
      this.outer.toggleClass('no-dots', !!this.board.dotsHidden);
      this.dotsToggleBtn?.toggleClass('is-active', !this.board.dotsHidden);
      this.scheduleSave();
    });
    this.dotsToggleBtn.toggleClass('is-active', !this.board.dotsHidden);

    // ── Overflow separator + button ──
    addPanel.createDiv('icon-board-tb-overflow-sep');
    const overflowBtn = addPanel.createDiv('icon-board-tb-btn icon-board-tb-overflow-btn');
    overflowBtn.setAttribute('tabindex', '0'); overflowBtn.setAttribute('aria-label', 'More…');
    overflowBtn.setText('···');
    overflowBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleOverflow(overflowBtn); });
    overflowBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleOverflow(overflowBtn); }
    });

    // ── Mobile FAB ──
    const fab = this.fabEl = tb.createDiv('icon-board-freeform-toolbar-fab');
    fab.setAttribute('aria-label', 'Add card');
    setIcon(fab, 'plus');
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      tb.toggleClass('is-open');
      fab.empty();
      setIcon(fab, tb.hasClass('is-open') ? 'x' : 'plus');
    });

    // ── Context bar (occupies the same slot, shown when a card is selected) ──
    this.contextBar = new ContextBar(tb, e => this.handleCtxEvent(e));
  }

  private toggleOverflow(anchor: HTMLElement): void {
    if (this.overflowPopover) { this.closeOverflow(); return; }

    const pop = this.overflowPopover = this.container.createDiv('icon-board-tb-overflow');
    const mkOv = (label: string, icon: string, tool: string) => {
      const btn = pop.createDiv('icon-board-tb-overflow-item');
      btn.setAttribute('tabindex', '0');
      const iconEl = btn.createDiv('icon-board-tb-overflow-icon');
      setIcon(iconEl, icon);
      btn.createSpan({ text: label });
      const handler = () => { this.closeOverflow(); this.activateTool(tool, btn); };
      btn.addEventListener('click', handler);
      btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    };
    mkOv('Image',     'image',     'image');
    mkOv('Audio',     'music',     'audio');
    mkOv('Note Link', 'file-text', 'notelink');

    pop.createDiv('icon-board-tb-overflow-sep');

    // Dots toggle inside overflow
    const dotsItem = pop.createDiv('icon-board-tb-overflow-item');
    dotsItem.setAttribute('tabindex', '0');
    const dotsIcon = dotsItem.createDiv('icon-board-tb-overflow-icon');
    setIcon(dotsIcon, 'grid-2x2');
    dotsItem.createSpan({ text: this.board.dotsHidden ? 'Show dots' : 'Hide dots' });
    dotsItem.toggleClass('is-active', !this.board.dotsHidden);
    dotsItem.addEventListener('click', () => {
      this.board.dotsHidden = !this.board.dotsHidden;
      this.outer.toggleClass('no-dots', !!this.board.dotsHidden);
      dotsItem.setText(this.board.dotsHidden ? 'Show dots' : 'Hide dots');
      dotsItem.toggleClass('is-active', !this.board.dotsHidden);
      this.scheduleSave();
      this.closeOverflow();
    });

    // Position the overflow relative to the anchor based on toolbar side
    const aRect = anchor.getBoundingClientRect();
    const cRect = this.container.getBoundingClientRect();
    if (this.toolbarPosition === 'right') {
      pop.style.top  = `${aRect.top - cRect.top}px`;
      pop.style.right = `${cRect.right - aRect.left + 8}px`;
    } else if (this.toolbarPosition === 'bottom') {
      pop.style.bottom = `${cRect.bottom - aRect.top + 8}px`;
      pop.style.left   = `${aRect.left - cRect.left}px`;
    } else if (this.toolbarPosition === 'top') {
      pop.style.top  = `${aRect.bottom - cRect.top + 8}px`;
      pop.style.left = `${aRect.left - cRect.left}px`;
    } else {
      pop.style.top  = `${aRect.top - cRect.top}px`;
      pop.style.left = `${aRect.right - cRect.left + 8}px`;
    }

    // Dismiss on outside click
    const onOutside = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node) && e.target !== anchor) {
        this.closeOverflow();
        activeDocument.removeEventListener('mousedown', onOutside);
      }
    };
    window.setTimeout(() => activeDocument.addEventListener('mousedown', onOutside), 0);
  }

  private closeOverflow(): void {
    this.overflowPopover?.remove();
    this.overflowPopover = null;
  }

  private closeFab(): void {
    if (!this.toolbarEl.hasClass('is-open')) return;
    this.toolbarEl.removeClass('is-open');
    if (this.fabEl) { this.fabEl.empty(); setIcon(this.fabEl, 'plus'); }
  }

  // ── Accent colour popover (checklist) ─────────────────────────

  private showAccentColorPopover(cardEl: HTMLElement, card: ChecklistCard): void {
    const existing = this.container.querySelector<HTMLElement>('.icon-board-accent-pop');
    if (existing) { existing.remove(); return; }

    const pop = this.container.createDiv('icon-board-accent-pop');

    const palette = pop.createDiv('icon-board-accent-pop-palette');
    const ACCENT_COLORS = [
      '#EF4444', '#F59E0B', '#EAB308', '#84CC16',
      '#10B981', '#06B6D4', '#3B82F6', '#8B5CF6',
      '#EC4899', '#64748B', '#44403C', '#FFFFFF',
    ];
    for (const hex of ACCENT_COLORS) {
      const sw = palette.createDiv('icon-board-accent-pop-swatch');
      sw.style.backgroundColor = hex;
      if (hex === card.accentColor) sw.addClass('is-selected');
      if (hex === '#FFFFFF') sw.addClass('has-border');
      sw.addEventListener('click', () => {
        this.pushUndo(); card.accentColor = hex;
        const bar = cardEl.querySelector<HTMLElement>('.icon-board-checklist-accent');
        if (bar) bar.style.backgroundColor = hex;
        this.scheduleSave(); pop.remove();
      });
    }

    const hexRow = pop.createDiv('icon-board-accent-pop-hex-row');
    const hexInput = hexRow.createEl('input', { cls: 'icon-board-accent-pop-hex', type: 'text', placeholder: '#EF4444' });
    hexInput.value = card.accentColor ?? '';
    hexInput.addEventListener('pointerdown', e => e.stopPropagation());
    hexInput.addEventListener('change', () => {
      const val = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        this.pushUndo(); card.accentColor = val;
        const bar = cardEl.querySelector<HTMLElement>('.icon-board-checklist-accent');
        if (bar) bar.style.backgroundColor = val;
        this.scheduleSave(); pop.remove();
      }
    });

    // Position popover near the card
    const cRect = this.container.getBoundingClientRect();
    const eRect = cardEl.getBoundingClientRect();
    pop.style.top  = `${eRect.bottom - cRect.top + 6}px`;
    pop.style.left = `${eRect.left - cRect.left}px`;

    const dismiss = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) { pop.remove(); activeDocument.removeEventListener('mousedown', dismiss); }
    };
    window.setTimeout(() => activeDocument.addEventListener('mousedown', dismiss), 0);
  }

  // ── Zoom pill ──────────────────────────────────────────────────

  private renderZoomPill(): void {
    this.zoomPill = this.container.createDiv('icon-board-zoom-pill');
    this.zoomPill.setAttribute('title', 'Click to reset zoom to 100%');
    this.zoomPill.setText(`${Math.round(this.vp.zoom * 100)}%`);
    this.zoomPill.addEventListener('click', () => { this.vp = { x: 0, y: 0, zoom: 1 }; this.applyViewport(); this.scheduleSave(); });
  }

  // ── Alignment bar ──────────────────────────────────────────────

  private renderAlignBar(): void {
    this.alignBarEl = this.container.createDiv('icon-board-align-bar');

    type AlignMode = Parameters<FreeformRenderer['alignCards']>[0];
    // H group: horizontal alignment — adjusts X positions (left/right edges)
    const ALIGN_BTNS: { icon: string; title: string; mode: AlignMode }[] = [
      { icon: 'align-start-vertical',  title: 'Align left edges',        mode: 'left'        },
      { icon: 'align-center-vertical', title: 'Center horizontally',     mode: 'center-h'    },
      { icon: 'align-end-vertical',    title: 'Align right edges',       mode: 'right'       },
      { icon: 'arrows-left-right',     title: 'Distribute horizontally', mode: 'distribute-h'},
    ];
    // V group: vertical alignment — adjusts Y positions (top/bottom edges)
    const VALIGN_BTNS: { icon: string; title: string; mode: AlignMode }[] = [
      { icon: 'align-start-horizontal',  title: 'Align top edges',       mode: 'top'         },
      { icon: 'align-center-horizontal', title: 'Center vertically',     mode: 'middle-v'    },
      { icon: 'align-end-horizontal',    title: 'Align bottom edges',    mode: 'bottom'      },
      { icon: 'arrows-up-down',          title: 'Distribute vertically', mode: 'distribute-v'},
    ];

    const makeBtn = (parent: HTMLElement, icon: string, title: string, mode: AlignMode) => {
      const btn = parent.createDiv('icon-board-align-bar-btn');
      btn.setAttribute('title', title);
      setIcon(btn, icon);
      btn.addEventListener('click', () => this.alignCards(mode));
    };

    const hGroup = this.alignBarEl.createDiv('icon-board-align-bar-group');
    const hLabel = hGroup.createSpan('icon-board-align-bar-label');
    hLabel.setText('H');
    for (const { icon, title, mode } of ALIGN_BTNS) makeBtn(hGroup, icon, title, mode);

    this.alignBarEl.createDiv('icon-board-align-bar-sep');

    const vGroup = this.alignBarEl.createDiv('icon-board-align-bar-group');
    const vLabel = vGroup.createSpan('icon-board-align-bar-label');
    vLabel.setText('V');
    for (const { icon, title, mode } of VALIGN_BTNS) makeBtn(vGroup, icon, title, mode);
  }

  // ── Connection layer ───────────────────────────────────────────

  private initConnectionLayer(): void {
    const ns = 'http://www.w3.org/2000/svg';

    // Visual layer — behind cards (first child of inner)
    const svg = activeDocument.createElementNS(ns, 'svg');
    svg.classList.add('icon-board-connections-svg');
    this.svgDefs = activeDocument.createElementNS(ns, 'defs');
    svg.appendChild(this.svgDefs);
    if (this.inner.firstChild) this.inner.insertBefore(svg, this.inner.firstChild);
    else this.inner.appendChild(svg);
    this.svgEl = svg;

    // Hit layer — above all cards so connection lines are always clickable
    const hitSvg = activeDocument.createElementNS(ns, 'svg');
    hitSvg.classList.add('icon-board-connections-hit-svg');
    this.inner.appendChild(hitSvg);
    this.hitSvgEl = hitSvg;
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
    const hit = activeDocument.createElementNS(ns, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', '#000000');
    hit.setAttribute('stroke-opacity', '0');
    hit.setAttribute('stroke-width', '12');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('cursor', 'pointer');
    hit.setAttribute('pointer-events', 'stroke');
    hit.addEventListener('click', (e) => { e.stopPropagation(); this.selectConnection(conn.id); });
    hit.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.selectConnection(conn.id);
      const menu = new Menu();
      menu.addItem(i => i.setTitle('Delete connection').setIcon('trash-2').onClick(() => this.deleteSelectedConnection()));
      menu.showAtMouseEvent(e);
    });
    this.hitSvgEl.appendChild(hit);
    this.connectionHitPaths.set(conn.id, hit);

    // Visible path (pointer-events:none so hit area handles all events)
    const path = activeDocument.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', conn.color);
    path.setAttribute('stroke-width', String(conn.thickness));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'butt');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('pointer-events', 'none');
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
    const g = activeDocument.createElementNS(ns, 'g');
    g.setAttribute('pointer-events', 'none');
    const bg = getComputedStyle(activeDocument.body).getPropertyValue('--background-primary').trim() || '#ffffff';
    const addText = (strokeColor: string | null, fillColor: string) => {
      const t = activeDocument.createElementNS(ns, 'text');
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
      const marker = activeDocument.createElementNS(ns, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('markerWidth', String(size));
      marker.setAttribute('markerHeight', String(h));
      marker.setAttribute('refX', end === 'end' ? String(size) : '0');
      marker.setAttribute('refY', String(mid));
      marker.setAttribute('orient', end === 'end' ? 'auto' : 'auto-start-reverse');
      const poly = activeDocument.createElementNS(ns, 'polygon');
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
      this.ghostPath = activeDocument.createElementNS(ns, 'path');
      this.ghostPath.setAttribute('fill', 'none');
      this.ghostPath.setAttribute('stroke', 'var(--interactive-accent)');
      this.ghostPath.setAttribute('stroke-width', '1.5');
      this.ghostPath.setAttribute('stroke-dasharray', '6 4');
      this.ghostPath.setAttribute('stroke-linecap', 'round');
      this.ghostPath.setAttribute('pointer-events', 'none');
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
    const els = activeDocument.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const cardEl = el.closest<HTMLElement>('[data-id]');
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
    const tmp = activeDocument.body.createDiv('ib-color-probe');
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
    this.connectionSelectPath = activeDocument.createElementNS(ns, 'path');
    this.connectionSelectPath.setAttribute('d', d);
    this.connectionSelectPath.setAttribute('stroke', 'var(--interactive-accent)');
    this.connectionSelectPath.setAttribute('stroke-width', String(conn.thickness + 6));
    this.connectionSelectPath.setAttribute('stroke-opacity', '0.3');
    this.connectionSelectPath.setAttribute('fill', 'none');
    this.connectionSelectPath.setAttribute('stroke-linecap', 'round');
    this.connectionSelectPath.setAttribute('pointer-events', 'none');
    this.hitSvgEl.appendChild(this.connectionSelectPath);
    this.showConnectionProps(conn);
    this.contextBar?.showConn(conn);
  }

  private deselectConnection(): void {
    if (!this.selectedConnectionId) return;
    this.connectionSelectPath?.remove(); this.connectionSelectPath = null;
    this.selectedConnectionId = null;
    this.hideConnectionProps();
    this.contextBar?.hide();
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
      // Halo stays in hitSvgEl — just update its path data above
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
      const svg = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '20'); svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 20 16');
      const line = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
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
      const svg = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '22'); svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 22 16');
      const line = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
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

  private handleCtxEvent(e: CtxEvent): void {
    const cardId = this.selection.getIds()[0];
    const card = cardId ? this.board.cards.find(c => c.id === cardId) : null;
    const el = cardId ? this.cardEls.get(cardId) ?? null : null;
    const conn = this.selectedConnectionId
      ? this.board.connections.find(c => c.id === this.selectedConnectionId) ?? null
      : null;

    switch (e.type) {
      case 'delete': {
        if (conn) { this.deleteSelectedConnection(); return; }
        if (!card || !el) return;
        this.pushUndo();
        el.remove();
        this.cardEls.delete(card.id);
        this.board.cards = this.board.cards.filter(c => c.id !== card.id);
        this.selection.clear();
        this.contextBar.hide();
        this.scheduleSave();
        break;
      }
      case 'tile-edit': {
        if (card?.kind !== 'tile' || !el) return;
        new TileModal(this.app, card, (updated) => {
          const idx = this.board.cards.findIndex(c => c.id === updated.id);
          if (idx !== -1) this.board.cards[idx] = updated;
          this.renderCardContent(el, updated); this.bindCardEvents(el, updated); this.scheduleSave();
        }, this.file).open();
        break;
      }
      case 'sticky-format': {
        this.activeStickyApplyTag?.(e.cmd);
        break;
      }
      case 'sticky-color': {
        if (card?.kind !== 'sticky' || !el) return;
        this.pushUndo();
        card.color = e.hex;
        el.style.backgroundColor = e.hex;
        this.scheduleSave();
        break;
      }
      case 'sticky-top-color': {
        if (card?.kind !== 'sticky' || !el) return;
        this.pushUndo();
        card.topColor = e.hex ?? undefined;
        let strip = el.querySelector<HTMLElement>('.ib-card-top-strip');
        if (card.topColor) {
          if (!strip) {
            strip = el.createDiv('ib-card-top-strip');
            el.insertBefore(strip, el.firstChild);
          }
          strip.style.backgroundColor = card.topColor;
        } else {
          strip?.remove();
        }
        this.scheduleSave();
        break;
      }
      case 'checklist-accent': {
        if (card?.kind !== 'checklist' || !el) return;
        this.pushUndo();
        card.accentColor = e.hex;
        const accentBarA = el.querySelector<HTMLElement>('.icon-board-checklist-accent');
        if (accentBarA) accentBarA.style.backgroundColor = e.hex;
        this.scheduleSave();
        break;
      }
      case 'checklist-bg': {
        if (card?.kind !== 'checklist' || !el) return;
        this.pushUndo();
        card.color = e.hex;
        el.style.backgroundColor = e.hex;
        this.scheduleSave();
        break;
      }
      case 'checklist-top-color': {
        if (card?.kind !== 'checklist' || !el) return;
        this.pushUndo();
        card.accentColor = e.hex ?? undefined;
        let bar = el.querySelector<HTMLElement>('.icon-board-checklist-accent');
        if (card.accentColor) {
          if (!bar) { bar = el.createDiv('icon-board-checklist-accent'); el.insertBefore(bar, el.firstChild); }
          bar.style.backgroundColor = card.accentColor;
        } else {
          bar?.remove();
        }
        this.scheduleSave();
        break;
      }
      case 'checklist-title': {
        if (card?.kind !== 'checklist' || !el) return;
        this.pushUndo();
        if (card.titleHidden) {
          card.titleHidden = false;
          this.rebuildChecklistCard(card); this.refreshSelectionVisuals();
          window.setTimeout(() => (this.cardEls.get(card.id)?.querySelector<HTMLElement>('.icon-board-checklist-title'))?.focus(), 0);
        } else {
          card.titleHidden = true;
          this.rebuildChecklistCard(card); this.refreshSelectionVisuals();
        }
        this.scheduleSave();
        break;
      }
      case 'image-caption': {
        if (card?.kind !== 'image' || !el) return;
        this.pushUndo();
        card.captionHidden = !card.captionHidden;
        const wrap = el.querySelector<HTMLElement>('.icon-board-image-caption-wrap');
        if (wrap) wrap.toggleClass('is-hidden', !!card.captionHidden);
        if (!card.captionHidden) {
          // Caption was just shown — click the view to enter edit mode
          window.setTimeout(() => {
            el.querySelector<HTMLElement>('.icon-board-image-caption-view')?.click();
          }, 0);
        }
        this.scheduleSave();
        break;
      }
      case 'notelink-display': {
        if (card?.kind !== 'note-link' || !el) return;
        this.pushUndo();
        card.displayMode = card.displayMode === 'preview' ? 'title-only' : 'preview';
        this.renderCardContent(el, card); this.bindCardEvents(el, card); this.scheduleSave();
        break;
      }
      case 'notelink-open': {
        if (card?.kind !== 'note-link') return;
        const file = this.app.vault.getAbstractFileByPath(card.path);
        if (file instanceof TFile) void this.app.workspace.openLinkText(file.path, '', true);
        break;
      }
      case 'bookmark-refresh': {
        if (card?.kind !== 'bookmark' || !el) return;
        card.fetchFailed = false; card.fetchedAt = undefined;
        this.renderCardContent(el, card); this.bindCardEvents(el, card);
        void this.fetchAndUpdateBookmark(card, el);
        break;
      }
      case 'bookmark-copy-url': {
        if (card?.kind !== 'bookmark') return;
        void navigator.clipboard.writeText(card.url); new Notice('URL copied.');
        break;
      }
      case 'kanban-color': {
        if (card?.kind !== 'kanban-column') return;
        this.pushUndo();
        card.color = e.hex;
        this.rebuildKanbanCard(card);
        this.scheduleSave();
        break;
      }
      case 'kanban-bg': {
        if (card?.kind !== 'kanban-column' || !el) return;
        this.pushUndo();
        card.bgColor = e.hex ?? undefined;
        el.style.backgroundColor = card.bgColor ?? '';
        this.scheduleSave();
        break;
      }
      case 'kanban-top-color': {
        if (card?.kind !== 'kanban-column' || !el) return;
        this.pushUndo();
        card.topColor = e.hex ?? undefined;
        let strip = el.querySelector<HTMLElement>('.ib-card-top-strip');
        if (card.topColor) {
          if (!strip) {
            strip = el.createDiv('ib-card-top-strip');
            el.insertBefore(strip, el.firstChild);
          }
          strip.style.backgroundColor = card.topColor;
        } else {
          strip?.remove();
        }
        this.scheduleSave();
        break;
      }
      case 'kanban-title': {
        if (card?.kind !== 'kanban-column' || !el) return;
        this.pushUndo();
        if (card.titleHidden) {
          card.titleHidden = false;
          this.rebuildKanbanCard(card);
          this.refreshSelectionVisuals();
          this.scheduleSave();
          window.setTimeout(() => {
            const newEl = this.cardEls.get(card.id);
            const titleEl = newEl?.querySelector<HTMLElement>('.icon-board-kanban-title');
            if (newEl && titleEl) this.editKanbanTitle(card, newEl, titleEl);
          }, 0);
        } else {
          card.titleHidden = true;
          this.rebuildKanbanCard(card);
          this.refreshSelectionVisuals();
          this.scheduleSave();
        }
        break;
      }
      case 'kanban-add-col': {
        if (card?.kind !== 'kanban-column') return;
        const newCard: KanbanColumnCard = {
          id: crypto.randomUUID(), kind: 'kanban-column',
          x: card.x + card.w + 20, y: card.y,
          w: KANBAN_DEFAULT_W, h: KANBAN_DEFAULT_H, z: this.nextZ(),
          color: '#6b7280', items: [],
        };
        this.pushUndo();
        this.board.cards.push(newCard);
        this.createCardEl(newCard);
        this.selection.select(newCard.id);
        this.refreshSelectionVisuals();
        window.setTimeout(() => {
          const newEl = this.cardEls.get(newCard.id);
          const titleEl = newEl?.querySelector<HTMLElement>('.icon-board-kanban-title');
          if (newEl && titleEl) this.editKanbanTitle(newCard, newEl, titleEl);
        }, 50);
        this.scheduleSave();
        break;
      }
      case 'conn-style': {
        if (!conn) return;
        this.pushUndo();
        conn.style = conn.style === 'solid' ? 'dashed' : 'solid';
        this.rerenderConnection(conn);
        this.showConnectionProps(conn);
        this.scheduleSave();
        break;
      }
      case 'conn-color': {
        if (!conn) return;
        this.pushUndo();
        conn.color = e.hex;
        this.rerenderConnection(conn);
        this.showConnectionProps(conn);
        this.scheduleSave();
        break;
      }
      case 'conn-arrow': {
        if (!conn) return;
        this.pushUndo();
        const arrowCycle: Array<Connection['arrowhead']> = ['end', 'both', 'none'];
        conn.arrowhead = arrowCycle[(arrowCycle.indexOf(conn.arrowhead) + 1) % arrowCycle.length];
        this.rerenderConnection(conn);
        this.showConnectionProps(conn);
        this.scheduleSave();
        break;
      }
      case 'conn-route': {
        if (!conn) return;
        this.pushUndo();
        conn.routing = conn.routing === 'straight' ? 'elbow' : 'straight';
        this.rerenderConnection(conn);
        this.showConnectionProps(conn);
        this.scheduleSave();
        break;
      }
    }
  }

  private hideConnectionProps(): void {
    this.connPropsEl?.remove();
    this.connPropsEl = null;
  }

  // ── Save ───────────────────────────────────────────────────────

  private scheduleSave(): void {
    this.board.viewport = { ...this.vp };
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; void this.saveNow(); }, 600);
  }

  private async saveNow(): Promise<void> {
    if (this.saveTimer) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.board.viewport = { ...this.vp };
    await this.onSave(this.board);
  }
}
