import Sortable from 'sortablejs';

/**
 * Attaches Sortable.js to the grid element so tiles can be dragged
 * to rearrange. The "+" add-tile button is excluded because only
 * `.icon-board-tile-wrapper` elements match the draggable selector.
 *
 * Generic over T so it works with any item type (TileCard, etc.).
 */
export function initDrag<T>(
  grid: HTMLElement,
  items: T[],
  onReorder: (reordered: T[]) => Promise<void>
): Sortable {
  return Sortable.create(grid, {
    animation: 150,
    draggable: '.icon-board-tile-wrapper',
    ghostClass: 'icon-board-tile-ghost',
    chosenClass: 'icon-board-tile-chosen',
    touchStartThreshold: 5,
    delay: 150,
    delayOnTouchOnly: true,
    onMove: (evt) => !evt.related.classList.contains('icon-board-add-tile'),
    onEnd: async (evt) => {
      const oldIdx = evt.oldDraggableIndex;
      const newIdx = evt.newDraggableIndex;
      if (oldIdx === undefined || newIdx === undefined || oldIdx === newIdx) return;

      const reordered = [...items];
      const [moved] = reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, moved);
      await onReorder(reordered);
    },
  });
}
