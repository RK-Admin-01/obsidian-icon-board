import { App, Modal, setIcon, getIconIds } from 'obsidian';

export class IconPickerModal extends Modal {
  private onSelect: (iconId: string) => void;
  private useEmoji = false;
  private searchTerm = '';

  constructor(app: App, onSelect: (iconId: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.modalEl.addClass('icon-board-icon-picker-modal');
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Choose Icon' });

    // Mode toggle row
    const toggleRow = contentEl.createDiv('icon-picker-toggle-row');
    const lucideBtn = toggleRow.createEl('button', {
      text: 'Icons',
      cls: this.useEmoji ? 'icon-picker-toggle-btn' : 'icon-picker-toggle-btn is-active',
    });
    const emojiBtn = toggleRow.createEl('button', {
      text: 'Emoji',
      cls: this.useEmoji ? 'icon-picker-toggle-btn is-active' : 'icon-picker-toggle-btn',
    });
    lucideBtn.addEventListener('click', () => { this.useEmoji = false; this.render(); });
    emojiBtn.addEventListener('click', () => { this.useEmoji = true; this.render(); });

    if (this.useEmoji) {
      contentEl.createEl('p', {
        text: 'Type or paste a single emoji character:',
        cls: 'icon-picker-hint',
      });
      const input = contentEl.createEl('input', {
        type: 'text',
        placeholder: '🎬',
        cls: 'icon-picker-emoji-input',
      });
      input.focus();
      input.addEventListener('input', () => {
        const chars = [...input.value];
        const emoji = chars.find(c => /\p{Emoji_Presentation}/u.test(c));
        if (emoji) {
          this.onSelect(emoji);
          this.close();
        }
      });
    } else {
      const searchInput = contentEl.createEl('input', {
        type: 'text',
        placeholder: 'Search icons…',
        cls: 'icon-picker-search',
      });
      searchInput.value = this.searchTerm;
      searchInput.focus();

      const iconGrid = contentEl.createDiv('icon-picker-grid');
      this.renderIconGrid(iconGrid, this.searchTerm);

      searchInput.addEventListener('input', () => {
        this.searchTerm = searchInput.value;
        this.renderIconGrid(iconGrid, this.searchTerm);
      });
    }
  }

  private renderIconGrid(grid: HTMLElement, filter: string): void {
    grid.empty();
    const allIds = getIconIds();
    const term = filter.toLowerCase().trim();
    const filtered = term ? allIds.filter(id => id.includes(term)) : allIds;
    const capped = filtered.slice(0, 300);

    for (const id of capped) {
      const btn = grid.createDiv('icon-picker-item');
      btn.setAttribute('aria-label', id);
      setIcon(btn, id);
      btn.addEventListener('click', () => {
        this.onSelect(id);
        this.close();
      });
    }

    if (capped.length === 0) {
      grid.createEl('p', { text: 'No icons found.', cls: 'icon-picker-empty' });
    }
  }
}
