import { App, Modal, Setting, TFile, TFolder, FuzzySuggestModal } from 'obsidian';
import { createBoardFile } from './file-io';
import type IconBoardPlugin from './main';

// ── Folder picker ─────────────────────────────────────────────

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onChoose: (folder: TFolder | null) => void;

  constructor(app: App, onChoose: (folder: TFolder | null) => void) {
    super(app);
    this.folders = app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search folders…');
  }

  getItems(): TFolder[] { return this.folders; }
  getItemText(item: TFolder): string { return item.path || '(vault root)'; }
  onChooseItem(item: TFolder): void { this.onChoose(item); }
}

// ── Create board modal ────────────────────────────────────────

export class CreateBoardModal extends Modal {
  private layout: 'grid' | 'freeform' = 'grid';
  private boardName = 'New Icon Board';
  private targetFolder: TFolder | null = null;
  private onCreated: (file: TFile) => void;
  private plugin: IconBoardPlugin;

  constructor(app: App, plugin: IconBoardPlugin, onCreated: (file: TFile) => void) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
    this.modalEl.addClass('icon-board-create-modal');
  }

  onOpen(): void { this.render(); }
  onClose(): void { this.contentEl.empty(); }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'New Icon Board' });

    // ── Layout picker ──
    contentEl.createEl('p', {
      text: 'Choose a layout — this cannot be changed after creation.',
      cls: 'icon-board-create-hint',
    });

    const layoutRow = contentEl.createDiv('icon-board-layout-row');
    for (const opt of [
      {
        value: 'grid' as const,
        label: 'Grid',
        icon: '⊞',
        desc: 'Ordered tiles in a responsive grid — clean and fast.',
      },
      {
        value: 'freeform' as const,
        label: 'Freeform',
        icon: '✦',
        desc: 'Infinite canvas with free-placed cards, pan and zoom.',
      },
    ]) {
      const card = layoutRow.createDiv(
        'icon-board-layout-card' + (this.layout === opt.value ? ' is-selected' : '')
      );
      const header = card.createDiv('icon-board-layout-card-header');
      header.createSpan({ text: opt.icon, cls: 'icon-board-layout-card-icon' });
      header.createEl('strong', { text: opt.label });
      card.createEl('p', { text: opt.desc, cls: 'icon-board-layout-card-desc' });
      card.addEventListener('click', () => { this.layout = opt.value; this.render(); });
    }

    // ── Name ──
    new Setting(contentEl)
      .setName('Board name')
      .addText(text => {
        text.setValue(this.boardName).onChange(v => { this.boardName = v; });
        window.setTimeout(() => { text.inputEl.select(); text.inputEl.focus(); }, 50);
      });

    // ── Location ──
    new Setting(contentEl)
      .setName('Location')
      .setDesc(this.targetFolder ? this.targetFolder.path : 'Vault root')
      .addButton(btn =>
        btn.setButtonText('Choose folder…').onClick(() => {
          new FolderSuggestModal(this.app, (folder) => {
            this.targetFolder = folder;
            this.render();
          }).open();
        })
      )
      .addButton(btn =>
        btn.setButtonText('Reset').onClick(() => {
          this.targetFolder = null;
          this.render();
        })
      );

    // ── Buttons ──
    const btnRow = contentEl.createDiv('icon-board-modal-buttons');
    btnRow.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());

    const createBtn = btnRow.createEl('button', { text: 'Create board', cls: 'mod-cta' });
    createBtn.addEventListener('click', () => { void (async () => {
      const name = this.boardName.trim() || 'New Icon Board';
      const file = await createBoardFile(this.app, name, this.targetFolder, this.layout);
      this.close();
      this.onCreated(file);
    })(); });
  }
}
