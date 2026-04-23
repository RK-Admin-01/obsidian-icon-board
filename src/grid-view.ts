import { App, setIcon, Menu, Notice, TFile, TFolder } from 'obsidian';
import Sortable from 'sortablejs';
import { IconBoardFile, TileCard } from './file-types';
import { writeBoardFile } from './file-io';
import { contrastColor } from './color-utils';
import { TileModal, ConfirmModal } from './tile-modal';
import { initDrag } from './drag';

export class GridRenderer {
  private sortable: Sortable | null = null;

  constructor(
    private app: App,
    private container: HTMLElement,
    private board: IconBoardFile,
    private file: TFile,
    private onNavigate: (boardPath: string) => Promise<void>
  ) {}

  render(): void {
    this.sortable?.destroy();
    this.sortable = null;
    this.container.empty();

    const grid = this.container.createDiv('icon-board-grid');
    const tiles = this.getSortedTiles();
    for (const tile of tiles) this.renderTile(grid, tile);

    // "Add tile" button
    const addBtn = grid.createDiv('icon-board-add-tile');
    addBtn.setAttribute('tabindex', '0');
    addBtn.setAttribute('role', 'button');
    addBtn.setAttribute('aria-label', 'Add tile');
    setIcon(addBtn.createDiv('icon-board-add-icon'), 'plus');
    addBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addBtn.click(); }
    });
    addBtn.addEventListener('click', () => {
      new TileModal(this.app, null, async (newTile) => {
        newTile.order = this.board.cards.length;
        this.board.cards.push(newTile);
        await this.save();
        this.render();
      }, this.file).open();
    });

    // Drag to rearrange
    this.sortable = initDrag(grid, tiles, async (reordered) => {
      // Update order fields and replace tiles in board.cards
      reordered.forEach((t, i) => { t.order = i; });
      const otherCards = this.board.cards.filter(c => c.kind !== 'tile');
      this.board.cards = [...reordered, ...otherCards];
      await this.save();
    });
  }

  destroy(): void {
    this.sortable?.destroy();
    this.sortable = null;
  }

  // ── Tile rendering ───────────────────────────────────────────

  private renderTile(grid: HTMLElement, tile: TileCard): void {
    const wrapper = grid.createDiv('icon-board-tile-wrapper');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('aria-label', tile.label + (tile.subtitle ? `, ${tile.subtitle}` : ''));

    const tileEl = wrapper.createDiv('icon-board-tile');
    tileEl.style.backgroundColor = tile.color;

    const iconColor = contrastColor(tile.color);
    const iconEl = tileEl.createDiv('icon-board-tile-icon');
    iconEl.style.color = iconColor;

    const isSingleEmoji =
      [...tile.icon].length === 1 && /\p{Emoji_Presentation}/u.test(tile.icon);
    if (isSingleEmoji) {
      iconEl.setText(tile.icon);
      iconEl.addClass('icon-board-tile-emoji');
    } else {
      setIcon(iconEl, tile.icon);
    }

    wrapper.createDiv({ cls: 'icon-board-tile-label', text: tile.label });
    if (tile.subtitle) {
      wrapper.createDiv({ cls: 'icon-board-tile-subtitle', text: tile.subtitle });
    }

    if (tile.target.kind === 'board') {
      const chevron = tileEl.createDiv('icon-board-tile-board-indicator');
      setIcon(chevron, 'chevron-right');
      chevron.style.color = iconColor;
    }

    if (tile.target.kind === 'kanban') {
      const indicator = tileEl.createDiv('icon-board-tile-board-indicator');
      setIcon(indicator, 'columns-3');
      indicator.style.color = iconColor;
    }

    // ── Interactions ─────────────────────────────────────────
    let suppressClick = false;

    wrapper.addEventListener('click', async () => {
      if (suppressClick) { suppressClick = false; return; }
      await this.activateTile(tile);
    });

    wrapper.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); await this.activateTile(tile); }
      if (e.key === 'F10' && e.shiftKey) {
        e.preventDefault();
        const rect = wrapper.getBoundingClientRect();
        wrapper.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left, clientY: rect.bottom })
        );
      }
    });

    wrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      suppressClick = true;
      const menu = new Menu();
      menu.addItem(item =>
        item.setTitle('Edit').setIcon('pencil').onClick(() => {
          new TileModal(this.app, tile, async (updated) => {
            const idx = this.board.cards.findIndex(c => c.id === updated.id);
            if (idx !== -1) this.board.cards[idx] = updated;
            await this.save();
            this.render();
          }, this.file).open();
        })
      );
      menu.addSeparator();
      menu.addItem(item =>
        item.setTitle('Delete').setIcon('trash').onClick(() => {
          const msg = `Delete "${tile.label}"?`;
          new ConfirmModal(this.app, msg, async () => {
            this.board.cards = this.board.cards.filter(c => c.id !== tile.id);
            await this.save();
            this.render();
          }).open();
        })
      );
      menu.showAtMouseEvent(e);
    });

    // Long-press for mobile
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    wrapper.addEventListener('pointerdown', (e) => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        suppressClick = true;
        wrapper.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY })
        );
      }, 600);
    });
    wrapper.addEventListener('pointerup', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
    wrapper.addEventListener('pointermove', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
  }

  // ── Tile activation ──────────────────────────────────────────

  private async activateTile(tile: TileCard): Promise<void> {
    const { target } = tile;

    if (target.kind === 'board') {
      await this.onNavigate(target.path);
      return;
    }

    if (!target.path) { new Notice('This tile has no target set.'); return; }

    const abstract = this.app.vault.getAbstractFileByPath(target.path);
    if (!abstract) { new Notice(`Target no longer exists: ${target.path}`); return; }

    if (target.kind === 'note' || target.kind === 'canvas') {
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(abstract as TFile);
      this.app.workspace.revealLeaf(leaf);
      return;
    }

    if (target.kind === 'kanban') {
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(abstract as TFile);
      this.app.workspace.revealLeaf(leaf);
      const isInstalled = (this.app as any).plugins?.enabledPlugins?.has('obsidian-kanban') ?? false;
      if (!isInstalled) new Notice('Install the community "Kanban" plugin to view this as a board.');
      return;
    }

    if (target.kind === 'folder') {
      const folder = abstract as TFolder;
      const explorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
      if (explorerLeaves.length > 0) {
        const view = explorerLeaves[0].view as any;
        if (typeof view.revealInFolder === 'function') view.revealInFolder(folder);
      }
      const firstNote = folder.children.find(
        f => f instanceof TFile && (f as TFile).extension === 'md'
      ) as TFile | undefined;
      if (firstNote) {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.openFile(firstNote);
        this.app.workspace.revealLeaf(leaf);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private getSortedTiles(): TileCard[] {
    return this.board.cards
      .filter((c): c is TileCard => c.kind === 'tile')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  private async save(): Promise<void> {
    await writeBoardFile(this.app, this.file, this.board);
  }
}
