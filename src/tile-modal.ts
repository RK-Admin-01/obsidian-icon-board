import {
  App,
  Modal,
  Setting,
  FuzzySuggestModal,
  TFolder,
  TFile,
  Notice,
  setIcon,
} from 'obsidian';
import { TileCard, TileTarget } from './file-types';
import { IconPickerModal } from './icon-picker';
import { contrastColor } from './color-utils';
import { createBoardFile } from './file-io';

const COLOR_PALETTE = [
  '#EF4444', '#F59E0B', '#EAB308', '#84CC16',
  '#10B981', '#06B6D4', '#3B82F6', '#8B5CF6',
  '#EC4899', '#64748B', '#44403C', '#FFFFFF',
];

// ── Path fuzzy-suggest ────────────────────────────────────────

class PathSuggestModal extends FuzzySuggestModal<string> {
  private paths: string[];
  private onChoose: (path: string) => void;

  constructor(app: App, paths: string[], onChoose: (path: string) => void) {
    super(app);
    this.paths = paths;
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search…');
  }

  getItems(): string[] { return this.paths; }
  getItemText(item: string): string { return item; }
  onChooseItem(item: string): void { this.onChoose(item); }
}

// ── Confirm modal ─────────────────────────────────────────────

export class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('p', { text: this.message });
    const btnRow = contentEl.createDiv('icon-board-modal-buttons');
    btnRow.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());
    const delBtn = btnRow.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    delBtn.addEventListener('click', () => { this.onConfirm(); this.close(); });
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Board name prompt ─────────────────────────────────────────

class NamePromptModal extends Modal {
  constructor(app: App, private heading: string, private placeholder: string, private onCreate: (name: string) => void) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.heading });
    const input = contentEl.createEl('input', { type: 'text', placeholder: this.placeholder });
    input.addClass('icon-board-board-name-input');
    const row = contentEl.createDiv('icon-board-modal-buttons');
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const btn = row.createEl('button', { text: 'Create', cls: 'mod-cta' });
    btn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) { new Notice('Enter a name.'); return; }
      this.onCreate(name); this.close();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    setTimeout(() => input.focus(), 50);
  }

  onClose(): void { this.contentEl.empty(); }
}

// ── Tile modal ────────────────────────────────────────────────

type TargetKind = TileTarget['kind'];

export class TileModal extends Modal {
  private tile: Partial<TileCard>;
  private targetKind: TargetKind;
  private targetPath: string;
  private onSave: (tile: TileCard) => void;
  private isEditing: boolean;
  private currentFile: TFile | null;

  constructor(app: App, existingTile: TileCard | null, onSave: (tile: TileCard) => void, currentFile: TFile | null = null, initialKind?: TargetKind) {
    super(app);
    this.onSave = onSave;
    this.isEditing = existingTile !== null;
    this.currentFile = currentFile;

    if (existingTile) {
      this.tile = { ...existingTile };
      this.targetKind = existingTile.target.kind;
      this.targetPath = existingTile.target.path;
    } else {
      this.tile = {
        id: crypto.randomUUID(),
        kind: 'tile',
        label: '',
        icon: 'star',
        color: '#3B82F6',
      };
      this.targetKind = initialKind ?? 'note';
      this.targetPath = '';
    }

    this.modalEl.addClass('icon-board-tile-modal');
  }

  onOpen(): void { this.render(); }
  onClose(): void { this.contentEl.empty(); }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: this.isEditing ? 'Edit Tile' : 'Add Tile' });

    // ── Label ──
    new Setting(contentEl)
      .setName('Label')
      .setDesc('Required — shown below the tile')
      .addText(text => {
        text.setPlaceholder('My Board').setValue(this.tile.label ?? '').onChange(v => {
          this.tile.label = v;
        });
        setTimeout(() => text.inputEl.focus(), 50);
      });

    // ── Subtitle ──
    new Setting(contentEl)
      .setName('Subtitle')
      .setDesc('Optional — smaller text below the label')
      .addText(text =>
        text
          .setPlaceholder('e.g. "95 boards"')
          .setValue(this.tile.subtitle ?? '')
          .onChange(v => { this.tile.subtitle = v || undefined; })
      );

    // ── Icon ──
    const iconSetting = new Setting(contentEl).setName('Icon');
    const previewWrap = iconSetting.controlEl.createDiv('icon-board-modal-icon-preview');
    previewWrap.style.backgroundColor = this.tile.color ?? '#3B82F6';
    const iconEl = previewWrap.createDiv('icon-board-modal-icon-el');
    iconEl.style.color = contrastColor(this.tile.color ?? '#3B82F6');
    const isSingleEmoji =
      !!this.tile.icon &&
      [...this.tile.icon].length === 1 &&
      /\p{Emoji_Presentation}/u.test(this.tile.icon);
    if (isSingleEmoji) {
      iconEl.setText(this.tile.icon!);
      iconEl.addClass('icon-board-modal-emoji');
    } else {
      setIcon(iconEl, this.tile.icon ?? 'star');
    }
    iconSetting.addButton(btn =>
      btn.setButtonText('Choose icon').onClick(() => {
        new IconPickerModal(this.app, selected => {
          this.tile.icon = selected;
          this.render();
        }).open();
      })
    );

    // ── Color ──
    const colorSetting = new Setting(contentEl).setName('Color');
    const palette = colorSetting.controlEl.createDiv('icon-board-modal-palette');
    for (const hex of COLOR_PALETTE) {
      const swatch = palette.createDiv('icon-board-modal-swatch');
      swatch.style.backgroundColor = hex;
      if (hex === this.tile.color) swatch.addClass('is-selected');
      if (hex === '#FFFFFF') swatch.addClass('has-border');
      swatch.addEventListener('click', () => { this.tile.color = hex; this.render(); });
    }
    const hexInput = colorSetting.controlEl.createEl('input', {
      type: 'text',
      placeholder: '#3B82F6',
      cls: 'icon-board-modal-hex-input',
    });
    hexInput.value = this.tile.color ?? '#3B82F6';
    hexInput.addEventListener('change', () => {
      const val = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) { this.tile.color = val; this.render(); }
    });

    const colorWheel = colorSetting.controlEl.createEl('input');
    colorWheel.type = 'color';
    colorWheel.value = this.tile.color ?? '#3B82F6';
    colorWheel.addClass('icon-board-modal-color-wheel');
    colorWheel.addEventListener('input', () => {
      this.tile.color = colorWheel.value;
      previewWrap.style.backgroundColor = colorWheel.value;
      iconEl.style.color = contrastColor(colorWheel.value);
      hexInput.value = colorWheel.value;
      palette.querySelectorAll<HTMLElement>('.icon-board-modal-swatch').forEach(s => s.removeClass('is-selected'));
    });
    colorWheel.addEventListener('change', () => { this.tile.color = colorWheel.value; this.render(); });

    // ── Kind dropdown ──
    new Setting(contentEl)
      .setName('Type')
      .addDropdown(dd =>
        dd
          .addOption('note', 'Note')
          .addOption('folder', 'Folder')
          .addOption('canvas', 'Canvas')
          .addOption('kanban', 'Kanban board')
          .addOption('board', 'Nested board (.iboard)')
          .setValue(this.targetKind)
          .onChange(v => {
            this.targetKind = v as TargetKind;
            this.targetPath = '';
            this.render();
          })
      );

    // ── Target path ──
    if (this.targetKind === 'kanban') {
      const isInstalled = (this.app as any).plugins?.enabledPlugins?.has('obsidian-kanban') ?? false;
      const kanbanPaths = this.getKanbanPaths();

      const pathSetting = new Setting(contentEl)
        .setName('Kanban board')
        .setDesc('Choose a .md file managed by the Kanban plugin');

      pathSetting.controlEl.createEl('span', {
        text: this.targetPath || 'None selected',
        cls: 'icon-board-modal-path-display' + (this.targetPath ? '' : ' is-empty'),
      });

      if (kanbanPaths.length > 0) {
        pathSetting.addButton(btn =>
          btn.setButtonText('Browse…').onClick(() => {
            new PathSuggestModal(this.app, kanbanPaths, selected => {
              this.targetPath = selected;
              this.render();
            }).open();
          })
        );
      } else if (isInstalled) {
        pathSetting.descEl.appendText(' — no Kanban boards found yet.');
      } else {
        pathSetting.descEl.appendText(' — install the community "Kanban" plugin first.');
      }

      if (isInstalled) {
        pathSetting.addButton(btn =>
          btn.setButtonText('Create new…').onClick(() => {
            this.close();
            (this.app as any).commands.executeCommandById('obsidian-kanban:create-new-kanban-board');
          })
        );
      }
    } else if (this.targetKind !== 'board') {
      const label = this.targetKind === 'folder' ? 'Folder'
        : this.targetKind === 'canvas' ? 'Canvas file'
        : 'Note';

      const pathSetting = new Setting(contentEl)
        .setName('Target')
        .setDesc(`Choose the ${label.toLowerCase()} to open when clicked`);

      pathSetting.controlEl.createEl('span', {
        text: this.targetPath || 'None selected',
        cls: 'icon-board-modal-path-display' + (this.targetPath ? '' : ' is-empty'),
      });

      pathSetting.addButton(btn =>
        btn.setButtonText('Browse…').onClick(() => {
          const paths = this.getPathsForKind(this.targetKind as 'folder' | 'canvas' | 'note');
          new PathSuggestModal(this.app, paths, selected => {
            this.targetPath = selected;
            this.render();
          }).open();
        })
      );

      pathSetting.addButton(btn =>
        btn.setButtonText('Create new…').onClick(() => {
          const heading = this.targetKind === 'folder' ? 'New folder'
            : this.targetKind === 'canvas' ? 'New canvas'
            : 'New note';
          const placeholder = this.targetKind === 'folder' ? 'Folder name'
            : this.targetKind === 'canvas' ? 'Canvas name'
            : 'Note name';
          new NamePromptModal(this.app, heading, placeholder, async (name) => {
            const basePath = this.currentFile?.parent?.path ?? '';
            const sep = basePath ? '/' : '';
            if (this.targetKind === 'folder') {
              const folderPath = basePath + sep + name;
              try {
                await this.app.vault.createFolder(folderPath);
                this.targetPath = folderPath;
                this.render();
              } catch { new Notice('Failed to create folder.'); }
            } else if (this.targetKind === 'canvas') {
              const filePath = basePath + sep + name + '.canvas';
              try {
                const f = await this.app.vault.create(filePath, '{"nodes":[],"edges":[]}');
                this.targetPath = f.path;
                this.render();
              } catch { new Notice('Failed to create canvas.'); }
            } else {
              const filePath = basePath + sep + name + '.md';
              try {
                const f = await this.app.vault.create(filePath, '');
                this.targetPath = f.path;
                this.render();
              } catch { new Notice('Failed to create note.'); }
            }
          }).open();
        })
      );
    } else {
      // Board target: pick an existing .iboard file or create a new nested one
      const iboardPaths = this.app.vault
        .getAllLoadedFiles()
        .filter(f => f instanceof TFile && (f as TFile).extension === 'iboard')
        .map(f => f.path)
        .sort();

      const pathSetting = new Setting(contentEl)
        .setName('Target board')
        .setDesc('Choose an existing board or create a new nested one');

      pathSetting.controlEl.createEl('span', {
        text: this.targetPath || 'None selected',
        cls: 'icon-board-modal-path-display' + (this.targetPath ? '' : ' is-empty'),
      });

      if (iboardPaths.length > 0) {
        pathSetting.addButton(btn =>
          btn.setButtonText('Browse…').onClick(() => {
            new PathSuggestModal(this.app, iboardPaths, selected => {
              this.targetPath = selected;
              this.render();
            }).open();
          })
        );
      }

      pathSetting.addButton(btn =>
        btn.setButtonText('Create new…').onClick(() => {
          new NamePromptModal(this.app, 'New nested board', 'Board name', async (name) => {
            // Nested boards live in a folder named after the current board stem
            let folderPath = '';
            if (this.currentFile) {
              folderPath = this.currentFile.path.replace(/\.iboard$/, '');
            }
            if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
              try { await this.app.vault.createFolder(folderPath); } catch { /* already exists */ }
            }
            const folder = folderPath
              ? (this.app.vault.getAbstractFileByPath(folderPath) as TFolder | null)
              : null;
            try {
              const newFile = await createBoardFile(this.app, name, folder, 'freeform');
              this.targetPath = newFile.path;
              this.render();
            } catch { new Notice('Failed to create board.'); }
          }).open();
        })
      );
    }

    // ── Buttons ──
    const btnRow = contentEl.createDiv('icon-board-modal-buttons');
    btnRow.createEl('button', { text: 'Cancel', cls: 'icon-board-modal-cancel' })
      .addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'mod-cta icon-board-modal-save' });
    saveBtn.addEventListener('click', () => {
      if (!this.tile.label?.trim()) { new Notice('Please enter a label.'); return; }
      if (!this.targetPath) { new Notice('Please select a target.'); return; }

      const saved: TileCard = {
        ...(this.tile as TileCard),
        target: { kind: this.targetKind, path: this.targetPath } as TileTarget,
      };
      this.onSave(saved);
      this.close();
    });
  }

  private getPathsForKind(kind: 'folder' | 'canvas' | 'note'): string[] {
    const all = this.app.vault.getAllLoadedFiles();
    if (kind === 'folder') return all.filter(f => f instanceof TFolder).map(f => f.path).sort();
    if (kind === 'canvas') return all.filter(f => f instanceof TFile && (f as TFile).extension === 'canvas').map(f => f.path).sort();
    return all.filter(f => f instanceof TFile && (f as TFile).extension === 'md').map(f => f.path).sort();
  }

  private getKanbanPaths(): string[] {
    return this.app.vault.getAllLoadedFiles()
      .filter(f => {
        if (!(f instanceof TFile) || (f as TFile).extension !== 'md') return false;
        const cache = this.app.metadataCache.getFileCache(f as TFile);
        return cache?.frontmatter != null && 'kanban-plugin' in cache.frontmatter;
      })
      .map(f => f.path)
      .sort();
  }
}
