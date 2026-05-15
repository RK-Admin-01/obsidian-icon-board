import { App, Notice, TFile, TFolder } from 'obsidian';
import { IconBoardFile } from './file-types';

// ── Read ──────────────────────────────────────────────────────

export async function readBoardFile(app: App, file: TFile): Promise<IconBoardFile> {
  const raw = await app.vault.read(file);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).cards)) {
      throw new Error('Not a valid .iboard file');
    }
    const board = parsed as IconBoardFile;
    // Migrate v2 → v3: add connections array and bump version
    if (!Array.isArray(board.connections)) {
      board.connections = [];
      board.version = 3;
      try { await writeBoardFile(app, file, board); } catch { /* silent */ }
    }
    return board;
  } catch {
    // Save a backup then return an empty board
    const backupPath = file.path + '.bak';
    try {
      if (!app.vault.getAbstractFileByPath(backupPath)) {
        await app.vault.create(backupPath, raw);
      }
    } catch { /* ignore */ }
    new Notice(
      `Icon Board: Could not read "${file.name}" — it may be corrupted. ` +
      `A backup was saved as "${file.name}.bak".`,
      8000
    );
    return emptyBoard('grid');
  }
}

// ── Write ─────────────────────────────────────────────────────

export async function writeBoardFile(app: App, file: TFile, board: IconBoardFile): Promise<void> {
  await app.vault.modify(file, JSON.stringify(board, null, 2));
}

// ── Create ────────────────────────────────────────────────────

export async function createBoardFile(
  app: App,
  name: string,
  folder: TFolder | null,
  layout: 'grid' | 'freeform'
): Promise<TFile> {
  const board = emptyBoard(layout);
  const safeName = name.trim() || 'New Icon Board';
  const baseName = safeName.endsWith('.iboard') ? safeName : `${safeName}.iboard`;
  const folderPath = folder ? folder.path : '';

  // Resolve conflicts
  let finalPath = folderPath ? `${folderPath}/${baseName}` : baseName;
  let counter = 1;
  while (app.vault.getAbstractFileByPath(finalPath)) {
    const stem = baseName.replace(/\.iboard$/, '');
    const candidate = `${stem} ${counter}.iboard`;
    finalPath = folderPath ? `${folderPath}/${candidate}` : candidate;
    counter++;
  }

  return app.vault.create(finalPath, JSON.stringify(board, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────

function emptyBoard(layout: 'grid' | 'freeform'): IconBoardFile {
  const board: IconBoardFile = { version: 3, layout, cards: [], connections: [] };
  if (layout === 'freeform') board.viewport = { x: 0, y: 0, zoom: 1 };
  return board;
}
