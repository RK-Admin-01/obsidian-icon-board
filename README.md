# Icon Board

A Milanote-style visual workspace for [Obsidian](https://obsidian.md). Build dashboards with icon tiles, freeform canvases, kanban columns, sticky notes, checklists, images, bookmarks, and linked notes, all in a single `.iboard` file.

## Features

### Grid Mode
- **Icon tiles** linking to folders, notes, canvases, kanban files, and nested boards
- Customisable icon (Lucide icon or emoji), colour, label, and subtitle

### Freeform Canvas Mode
- **Card types**: icon tiles, sticky notes, checklists, note links (with live preview), images, bookmarks, kanban columns
- **Connections** between cards — straight or elbow-routed, with colour, thickness, style, arrowhead, and label options
- **Multi-select** with marquee, group drag, alignment, and distribution
- **Resize** any card from its corner handle

### Kanban Columns
- Drag items between columns
- Inline markdown rendering in items
- Link items to vault notes; add tag pills
- Drop images directly into a column to attach them as items

### Image Support
- Drag images from Finder or the Obsidian file explorer onto the canvas or into kanban columns
- Paste images from the clipboard
- External URL or vault-file source

## Installation

### Community Plugin Browser (recommended)
1. Open Obsidian **Settings → Community plugins → Browse**
2. Search for **Icon Board**
3. Click **Install**, then **Enable**

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/RK-Admin-01/obsidian-icon-board/releases/latest)
2. Copy them into `<vault>/.obsidian/plugins/icon-board/`
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**

## Usage

1. Run **Icon Board: Open home board** from the command palette, or click the layout-dashboard ribbon icon
2. Click **+ New board** to create your first `.iboard` file
3. Right-click the canvas to add cards; drag the canvas to pan, scroll to zoom

## Development

```bash
git clone https://github.com/RK-Admin-01/obsidian-icon-board.git
cd obsidian-icon-board
npm install
npm run dev   # watch mode
```

Symlink or copy the folder into your vault's `.obsidian/plugins/` directory, then enable the plugin.

## License

MIT — see [LICENSE](LICENSE)
