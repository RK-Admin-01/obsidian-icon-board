// ── v1 tile type (kept for migration) ────────────────────────

export interface Tile {
  id: string;
  label: string;
  subtitle?: string;
  icon: string;
  color: string;
  kind: 'folder' | 'canvas' | 'note' | 'board';
  targetPath?: string;
  children?: Tile[];
}

// ── Plugin settings ───────────────────────────────────────────

export interface IconBoardSettings {
  // v1 data — cleared after migration, kept here for the legacy backup
  rootTiles: Tile[];
  openOnStartup: boolean;

  // v2 fields
  defaultBoardPath?: string;    // path to the board opened by the ribbon/command
  v2migrationDone?: boolean;    // prevents re-running migration
  legacyBackup?: Tile[];        // copy of v1 rootTiles saved during migration
  attachmentFolder?: string;    // where pasted/dropped images are saved; default 'attachments/icon-board'
  bookmarkCacheDays?: number;   // days before re-fetching bookmark OG metadata; default 30
  defaultStickyColor?: string;  // hex color used when creating new sticky notes
  toolbarPosition?: 'left' | 'right' | 'top' | 'bottom';
}

export const DEFAULT_SETTINGS: IconBoardSettings = {
  rootTiles: [],
  openOnStartup: false,
};
