import { Plugin, TFile, Notice } from 'obsidian';
import { IconBoardView, ICON_BOARD_VIEW_TYPE } from './view';
import { IconBoardSettingsTab } from './settings';
import { IconBoardSettings, DEFAULT_SETTINGS } from './types';
import { CreateBoardModal } from './create-board-modal';
import { needsMigration, migrateV1toV2 } from './migration';

export default class IconBoardPlugin extends Plugin {
  settings: IconBoardSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the view
    this.registerView(
      ICON_BOARD_VIEW_TYPE,
      (leaf) => new IconBoardView(leaf, this)
    );

    // Tell Obsidian to open .iboard files with our view
    this.registerExtensions(['iboard'], ICON_BOARD_VIEW_TYPE);

    // Ribbon — opens (or focuses) the default board
    this.addRibbonIcon('layout-grid', 'Icon Board', () => {
      this.openDefaultBoard();
    });

    // Command: open default board
    this.addCommand({
      id: 'open-icon-board',
      name: 'Open',
      callback: () => { this.openDefaultBoard(); },
    });

    // Command: create a new board
    this.addCommand({
      id: 'create-icon-board',
      name: 'Create new board',
      callback: () => {
        new CreateBoardModal(this.app, this, async (file) => {
          await this.openBoardFile(file);
        }).open();
      },
    });

    // Settings tab
    this.addSettingTab(new IconBoardSettingsTab(this.app, this));

    // Run migration + startup open after the workspace is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.runMigrationIfNeeded();

      if (this.settings.openOnStartup) {
        await this.openDefaultBoard();
      }
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(ICON_BOARD_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ── Board opening ─────────────────────────────────────────────

  async openDefaultBoard(): Promise<void> {
    const { workspace } = this.app;

    // If a board leaf is already visible, just focus it
    const existing = workspace.getLeavesOfType(ICON_BOARD_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // Try the stored default board path
    if (this.settings.defaultBoardPath) {
      const file = this.app.vault.getAbstractFileByPath(this.settings.defaultBoardPath);
      if (file instanceof TFile) {
        await this.openBoardFile(file);
        return;
      }
      // Path is stale — clear it
      this.settings.defaultBoardPath = undefined;
      await this.saveSettings();
    }

    // No default board — prompt to create one
    new CreateBoardModal(this.app, this, async (file) => {
      this.settings.defaultBoardPath = file.path;
      await this.saveSettings();
      await this.openBoardFile(file);
    }).open();
  }

  async openBoardFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  // ── Migration ─────────────────────────────────────────────────

  private async runMigrationIfNeeded(): Promise<void> {
    if (!needsMigration(this.settings)) return;

    try {
      const homeFile = await migrateV1toV2(this.app, this);
      // Immediately open the migrated home board
      await this.openBoardFile(homeFile);
    } catch (e) {
      console.error('Icon Board: migration failed', e);
      new Notice('Icon Board: Migration failed — your v1 tiles are still in plugin settings. Please report this issue.', 10000);
    }
  }
}
