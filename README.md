# Icon Board

A visual workspace for [Obsidian](https://obsidian.md) — build dashboards with icon tiles, a freeform canvas, kanban columns, sticky notes, checklists, images, audio, bookmarks, and linked notes, all stored in a single `.iboard` file in your vault.

<!-- Screenshot: home board grid with icon tiles -->
> **Note for beta testers:** Screenshots are coming. In the meantime, the Usage section below describes every part of the interface.

---

## Features

### Grid Mode
- **Icon tiles** that open folders, notes, canvases, kanban files, or nested boards
- Customise each tile's Lucide icon or emoji, background colour, label, and subtitle
- Drag to reorder; right-click to edit

### Freeform Canvas
- **Card types:** icon tiles, sticky notes, checklists, note links (with live Markdown preview), images, audio players, bookmarks, and kanban columns
- **Connections** between any two cards — straight or elbow-routed, with colour, thickness, line style, arrowhead, and inline label
- **Multi-select** via marquee or Shift-click; group drag, alignment bar, and even distribution
- **Resize** any card by dragging any of its four corners
- **Pan** with middle-click (or Space + drag) over any element on the canvas

### Kanban Columns
- Drag items between columns; set WIP limits
- Rich-text formatting in items (bold, italic, strikethrough, colour, highlight)
- Link items to vault notes; add tag pills
- Drop images or audio files directly into a column
- Toggle the column title; set background and accent-strip colours

### Sticky Notes
- Inline rich-text editing with **⌘ B / I / U** and **⌘ ⇧ S** shortcuts
- Bold, Italic, Underline, Strikethrough buttons in the context bar
- Background colour and top-strip accent via the context bar colour picker

### Checklists
- Toggle the card title on or off
- Set background and top-strip colours to match your visual style
- Header rows to group items into sections

### Text Formatting
- Select any text in a sticky note, checklist, kanban item, or image caption to reveal a floating toolbar
- Bold, italic, underline, strikethrough, text colour (preset + colour picker), and highlight colour

### Image & Audio
- Paste images from the clipboard
- Drag from Finder or the Obsidian file explorer onto the canvas or into a kanban column
- Add from the vault or upload from disk via the toolbar
- Images always display at their natural aspect ratio
- Toggle captions with **⌘ ⇧ C** (Mac) / **Ctrl ⇧ C** (Windows/Linux)
- All imported files are automatically sorted into `_Assets/` subfolders (see Asset Management below)

### Asset Management
- **Auto-sort:** every image, audio clip, video, or document imported into a board is automatically moved to the correct subfolder in the vault root:
  - `_Assets/Images/` — jpg, png, gif, webp, svg, …
  - `_Assets/Audio/` — mp3, wav, ogg, flac, …
  - `_Assets/Video/` — mp4, mov, mkv, …
  - `_Assets/Documents/` — pdf
- **Auto-relink:** scan all boards and fix broken file paths when a unique filename match is found in the vault. Three ways to run it:
  - **On open** — toggle *Auto-relink on board open* in Settings to fix links silently every time a board loads
  - **Settings button** — Settings → Assets → *Relink now*
  - **Command palette** — `Icon Board: Relink all board assets`

### Keyboard Shortcuts
| Action | Shortcut |
|---|---|
| Delete selected | Delete / Backspace |
| Select all | ⌘ A |
| Duplicate | ⌘ D |
| Undo | ⌘ Z |
| Redo | ⌘ ⇧ Z |
| Toggle image caption | ⌘ ⇧ C |
| Bold (sticky editor) | ⌘ B |
| Italic (sticky editor) | ⌘ I |
| Underline (sticky editor) | ⌘ U |
| Strikethrough (sticky editor) | ⌘ ⇧ S |

---

## Installation

### Community Plugin Browser *(once listed)*
1. Open **Settings → Community plugins → Browse**
2. Search for **Icon Board**
3. Click **Install**, then **Enable**

### Manual Installation *(for beta testers)*
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/RK-Admin-01/obsidian-icon-board/releases/latest)
2. In your vault, create the folder `.obsidian/plugins/icon-board/`
3. Copy the three files into that folder
4. Open Obsidian, go to **Settings → Community plugins**, and enable **Icon Board**

---

## Usage

### Opening a board
- Run **Icon Board: Open home board** from the command palette
- Or click the layout-dashboard icon in the left ribbon

### Creating your first board
1. Click **+ New board** in the empty home screen
2. A `.iboard` file is created in your vault root (you can move it later)
3. The board opens in grid mode — click the **+** button to add your first icon tile

### Grid mode
- **Click** a tile to open its target
- **Right-click** a tile to edit, change icon, change colour, or delete
- **Drag** tiles to reorder them

### Freeform canvas
- Switch to canvas mode with the toggle in the top-right corner of any board
- **Right-click** the canvas background to add a card (sticky, checklist, image, etc.)
- **Pan** by dragging the background, middle-clicking anywhere, or holding Space and dragging; **zoom** with the scroll wheel
- **Right-click** a card for options (edit, style, connect, delete)
- The **toolbar** on the left has one button per card type; click it or drag it onto the canvas

### Connections
- Right-click a card → **Connect** to enter connection mode, then click a second card
- Click a connection to select it; right-click for colour, thickness, and style options

### Fixing broken asset links
If you move files in the vault and board assets stop loading, run **Icon Board: Relink all board assets** from the command palette. For automatic fixing every time you open a board, enable *Auto-relink on board open* in Settings.

### Saving
Boards save automatically as you work. All data lives in the `.iboard` file — no external database or sync service is required.

---

## Compatibility

| Platform | Status |
|---|---|
| Obsidian desktop (Mac, Windows, Linux) | ✅ Supported |
| Obsidian mobile (iOS, iPadOS) | ✅ Supported |
| Minimum Obsidian version | 1.4.0 |

---

## Development

```bash
git clone https://github.com/RK-Admin-01/obsidian-icon-board.git
cd obsidian-icon-board
npm install
npm run dev        # watch mode — rebuilds on save
npm run build      # production build
```

Copy or symlink the folder into `<vault>/.obsidian/plugins/icon-board/`, then enable the plugin in Obsidian.

---

## License

[MIT](LICENSE) — © RK-Media
