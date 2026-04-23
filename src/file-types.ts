// ── v3 file format ───────────────────────────────────────────

export interface IconBoardFile {
  version: 2 | 3;
  layout: 'grid' | 'freeform';
  dotsHidden?: boolean;
  viewport?: { x: number; y: number; zoom: number }; // freeform only
  cards: Card[];
  connections: Connection[];  // empty for grid; freeform only
}

// ── Connection ────────────────────────────────────────────────

export interface Connection {
  id: string;
  fromCardId: string;
  toCardId: string;
  routing: 'straight' | 'elbow';
  elbowOrientation?: 'auto' | 'horizontal-first' | 'vertical-first';
  label?: string;
  color: string;
  style: 'solid' | 'dashed';
  arrowhead: 'end' | 'both' | 'none';
  thickness: 2 | 4 | 6;
}

// ── Base ─────────────────────────────────────────────────────

export interface BaseCard {
  id: string;
  order?: number;   // grid mode: position index
  x?: number;       // freeform: canvas X
  y?: number;       // freeform: canvas Y
  w?: number;       // freeform: width
  h?: number;       // freeform: height
  z?: number;       // freeform: z-index
}

// ── Tile card (the v1-style icon tile) ───────────────────────

export interface TileCard extends BaseCard {
  kind: 'tile';
  label: string;
  subtitle?: string;
  icon: string;   // Lucide name or single emoji
  color: string;  // hex
  target: TileTarget;
}

export type TileTarget =
  | { kind: 'folder';  path: string }
  | { kind: 'canvas';  path: string }
  | { kind: 'note';    path: string }
  | { kind: 'kanban';  path: string }
  | { kind: 'board';   path: string }; // .iboard file

// ── Other card types ──────────────────────────────────────────

export interface StickyCard extends BaseCard {
  kind: 'sticky';
  text: string;
  color: string;
  textScale?: 'sm' | 'md' | 'lg';
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  isHeader?: boolean;   // bold section label; checkbox tracks children
  parentId?: string;    // one level of nesting only
}

export interface ChecklistCard extends BaseCard {
  kind: 'checklist';
  title?: string;
  accentColor: string;  // hex; top accent bar colour
  items: ChecklistItem[];
  color: string;
}

export interface ImageCard extends BaseCard {
  kind: 'image';
  source:
    | { type: 'vault'; path: string }
    | { type: 'external'; url: string };
  caption?: string;
  captionHidden?: boolean;
  captionColor?: string;
  captionScale?: 'sm' | 'md' | 'lg';
}

export interface AudioCard extends BaseCard {
  kind: 'audio';
  source: { type: 'vault'; path: string };
  title?: string;
}

export interface NoteLinkCard extends BaseCard {
  kind: 'note-link';
  path: string;
  displayMode: 'preview' | 'title-only';
}

export interface BookmarkCard extends BaseCard {
  kind: 'bookmark';
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  favicon?: string;
  fetchedAt?: number;
  fetchFailed?: boolean;
}

export interface KanbanItem {
  id: string;
  text: string;
  done?: boolean;
  linkedNotePath?: string;
  tags?: string[];
  imagePath?: string;
  audioPath?: string;
}

export interface KanbanColumnCard extends BaseCard {
  kind: 'kanban-column';
  title?: string;
  color: string;
  wipLimit?: number;
  items: KanbanItem[];
}

export type Card =
  | TileCard | StickyCard | ChecklistCard
  | ImageCard | AudioCard | NoteLinkCard | BookmarkCard | KanbanColumnCard;
