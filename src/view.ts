import { FileView, WorkspaceLeaf, TFile, Notice, setIcon } from 'obsidian';
import type IconBoardPlugin from './main';
import { IconBoardFile } from './file-types';
import { readBoardFile, writeBoardFile } from './file-io';
import { GridRenderer } from './grid-view';
import { FreeformRenderer } from './freeform-view';

export const ICON_BOARD_VIEW_TYPE = 'icon-board-view';

export class IconBoardView extends FileView {
  plugin: IconBoardPlugin;

  // Navigation history: files visited before the current one.
  // Empty = this is the entry point.
  private navigationHistory: TFile[] = [];

  // Flag to distinguish internal navigation from an external file open.
  private isInternalNavigation = false;

  private renderer: GridRenderer | FreeformRenderer | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: IconBoardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  // A FileView can be open without a file (e.g. workspace restore with no state).
  allowNoFile = true;

  getViewType(): string { return ICON_BOARD_VIEW_TYPE; }

  getDisplayText(): string {
    return this.file ? this.file.basename : 'Icon Board';
  }

  getIcon(): string { return 'layout-grid'; }

  // Obsidian calls this when it assigns a file to the view.
  async onLoadFile(file: TFile): Promise<void> {
    if (!this.isInternalNavigation) {
      // Opened externally (ribbon, file explorer, workspace restore) — reset history.
      this.navigationHistory = [];
    }
    this.isInternalNavigation = false;

    const board = await readBoardFile(this.app, file);
    this.renderBoard(board, file);
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.destroyRenderer();
  }

  async onClose(): Promise<void> {
    this.destroyRenderer();
  }

  // Called when there is no file (e.g. workspace restore with missing state).
  protected async onOpen(): Promise<void> {
    if (!this.file) {
      this.renderEmpty();
    }
  }

  // ── Public navigation API (called by GridRenderer) ───────────

  async navigateToBoard(targetPath: string): Promise<void> {
    const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(targetFile instanceof TFile)) {
      new Notice(`Board file not found: ${targetPath}`);
      return;
    }
    this.isInternalNavigation = true;
    this.navigationHistory.push(this.file!);
    await this.leaf.openFile(targetFile);
  }

  async navigateBack(): Promise<void> {
    const prev = this.navigationHistory.pop();
    if (!prev) return;
    this.isInternalNavigation = true;
    await this.leaf.openFile(prev);
  }

  // ── Rendering ────────────────────────────────────────────────

  private renderBoard(board: IconBoardFile, file: TFile): void {
    this.destroyRenderer();

    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('icon-board-container');

    this.renderHeader(container, file);

    const content = container.createDiv('icon-board-content');

    if (board.layout === 'freeform') {
      this.renderer = new FreeformRenderer(
        this.app,
        content,
        board,
        file,
        (path) => this.navigateToBoard(path),
        async (updated) => { await writeBoardFile(this.app, file, updated); },
        this.plugin.settings.attachmentFolder ?? 'attachments/icon-board',
        this.plugin.settings.bookmarkCacheDays ?? 30
      );
    } else {
      this.renderer = new GridRenderer(
        this.app,
        content,
        board,
        file,
        (path) => this.navigateToBoard(path)
      );
    }

    this.renderer.render();
  }

  private renderHeader(container: HTMLElement, file: TFile): void {
    const header = container.createDiv('icon-board-view-header');

    // Back button (visible when we have history)
    const backBtn = header.createDiv('icon-board-back-btn' + (this.navigationHistory.length === 0 ? ' is-hidden' : ''));
    setIcon(backBtn, 'arrow-left');
    backBtn.setAttribute('aria-label', 'Go back');
    backBtn.addEventListener('click', () => this.navigateBack());

    // Breadcrumb
    const breadcrumb = header.createDiv('icon-board-breadcrumb');

    if (this.navigationHistory.length === 0) {
      breadcrumb.createSpan({ text: file.basename, cls: 'icon-board-breadcrumb-current' });
    } else {
      // Render history entries as clickable ancestors
      this.navigationHistory.forEach((histFile, i) => {
        const span = breadcrumb.createSpan({
          text: histFile.basename,
          cls: 'icon-board-breadcrumb-ancestor',
        });
        span.addEventListener('click', async () => {
          // Navigate back to this point: slice history to index i
          const target = this.navigationHistory[i];
          this.navigationHistory = this.navigationHistory.slice(0, i);
          this.isInternalNavigation = true;
          await this.leaf.openFile(target);
        });
        breadcrumb.createSpan({ text: '›', cls: 'icon-board-breadcrumb-sep' });
      });
      breadcrumb.createSpan({ text: file.basename, cls: 'icon-board-breadcrumb-current' });
    }
  }

  private renderEmpty(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('icon-board-container');
    const msg = container.createDiv('icon-board-empty-state');
    msg.createEl('p', { text: 'No board is open.' });
    msg.createEl('p', { text: 'Use "Icon Board: Create new board" or click an .iboard file in the file explorer.', cls: 'icon-board-empty-hint' });
  }

  private destroyRenderer(): void {
    this.renderer?.destroy();
    this.renderer = null;
  }
}
