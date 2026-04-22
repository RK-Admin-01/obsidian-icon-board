import { App, PluginSettingTab, Setting, Notice, FuzzySuggestModal, TFile } from 'obsidian';
import type IconBoardPlugin from './main';
import { ConfirmModal } from './tile-modal';
import { Tile } from './types';

// ── Board picker modal ────────────────────────────────────────

class BoardPickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (f: TFile) => void) {
    super(app);
    this.setPlaceholder('Search for a .iboard file…');
  }
  getItems(): TFile[] {
    return this.app.vault.getAllLoadedFiles()
      .filter((f): f is TFile => f instanceof TFile && (f as TFile).extension === 'iboard');
  }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.onChoose(f); }
}

// ── Settings tab ──────────────────────────────────────────────

export class IconBoardSettingsTab extends PluginSettingTab {
  plugin: IconBoardPlugin;
  private importText = '';

  constructor(app: App, plugin: IconBoardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Icon Board' });

    // ── Open on startup ──────────────────────────────────────
    new Setting(containerEl)
      .setName('Open on startup')
      .setDesc('Automatically open Icon Board when Obsidian starts.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.openOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Default board ────────────────────────────────────────
    const defaultSetting = new Setting(containerEl)
      .setName('Default board')
      .setDesc('Board opened when you click the ribbon icon or use the "Open" command.');

    const pathDisplay = defaultSetting.controlEl.createEl('span', {
      text: this.plugin.settings.defaultBoardPath ?? 'None',
      cls: 'icon-board-modal-path-display' + (this.plugin.settings.defaultBoardPath ? '' : ' is-empty'),
    });

    defaultSetting.addButton(btn =>
      btn.setButtonText('Browse…').onClick(() => {
        new BoardPickerModal(this.app, async (file) => {
          this.plugin.settings.defaultBoardPath = file.path;
          await this.plugin.saveSettings();
          pathDisplay.textContent = file.path;
          pathDisplay.removeClass('is-empty');
          // Update "Clear" button visibility by re-rendering
          this.display();
        }).open();
      })
    );

    if (this.plugin.settings.defaultBoardPath) {
      defaultSetting.addButton(btn =>
        btn.setButtonText('Clear').onClick(async () => {
          this.plugin.settings.defaultBoardPath = undefined;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    }

    // ── Freeform canvas ──────────────────────────────────────
    containerEl.createEl('h3', { text: 'Freeform canvas', cls: 'icon-board-settings-section' });

    new Setting(containerEl)
      .setName('Attachment folder')
      .setDesc('Vault path where pasted and dragged images are saved. Default: attachments/icon-board')
      .addText(text =>
        text
          .setPlaceholder('attachments/icon-board')
          .setValue(this.plugin.settings.attachmentFolder ?? '')
          .onChange(async (value) => {
            this.plugin.settings.attachmentFolder = value.trim() || undefined;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Bookmark cache duration')
      .setDesc('Days before bookmark previews are automatically re-fetched. Default: 30.')
      .addText(text => {
        text
          .setPlaceholder('30')
          .setValue(String(this.plugin.settings.bookmarkCacheDays ?? 30))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            this.plugin.settings.bookmarkCacheDays = (!isNaN(n) && n > 0) ? n : undefined;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.style.width = '70px';
      });

    // ── Export ───────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Data', cls: 'icon-board-settings-section' });

    new Setting(containerEl)
      .setName('Export tiles as JSON')
      .setDesc('Copy all your tile data to the clipboard as JSON.')
      .addButton(btn =>
        btn.setButtonText('Copy to clipboard').onClick(async () => {
          const json = JSON.stringify(this.plugin.settings.rootTiles, null, 2);
          await navigator.clipboard.writeText(json);
          new Notice('Tile data copied to clipboard.');
        })
      );

    // ── Import ───────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Import tiles from JSON')
      .setDesc(
        'Paste JSON exported from another vault. This will replace all existing tiles. ' +
        'Make sure the JSON is an array of tile objects.'
      );

    const importArea = containerEl.createEl('textarea', {
      cls: 'icon-board-settings-import-area',
      placeholder: '[\n  { "id": "...", "label": "...", ... }\n]',
    });
    importArea.addEventListener('input', () => {
      this.importText = importArea.value;
    });

    new Setting(containerEl)
      .addButton(btn =>
        btn
          .setButtonText('Import')
          .setCta()
          .onClick(() => {
            if (!this.importText.trim()) {
              new Notice('Paste some JSON first.');
              return;
            }
            let parsed: Tile[];
            try {
              parsed = JSON.parse(this.importText);
              if (!Array.isArray(parsed)) throw new Error('Not an array');
            } catch {
              new Notice('Invalid JSON — please check the format and try again.');
              return;
            }
            new ConfirmModal(
              this.app,
              `Replace all ${this.plugin.settings.rootTiles.length} existing tile(s) with the imported data?`,
              async () => {
                this.plugin.settings.rootTiles = parsed;
                await this.plugin.saveSettings();
                importArea.value = '';
                this.importText = '';
                new Notice(`Imported ${parsed.length} tile(s).`);
              }
            ).open();
          })
      );

    // ── Reset ────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Danger zone', cls: 'icon-board-settings-section' });

    new Setting(containerEl)
      .setName('Reset all tiles')
      .setDesc('Permanently delete every tile and nested board. This cannot be undone.')
      .addButton(btn =>
        btn
          .setButtonText('Reset everything')
          .setWarning()
          .onClick(() => {
            new ConfirmModal(
              this.app,
              `Delete all ${this.plugin.settings.rootTiles.length} tile(s)? This cannot be undone.`,
              async () => {
                this.plugin.settings.rootTiles = [];
                await this.plugin.saveSettings();
                new Notice('All tiles deleted.');
              }
            ).open();
          })
      );
  }
}
