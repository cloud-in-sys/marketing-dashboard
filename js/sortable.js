// ===== Drag-reorder helper =====
export function makeSortable(container, onReorder) {
  let dragKey = null;
  const axis = container.dataset.sortAxis || 'y';
  const clearMarks = () => {
    container.querySelectorAll('[data-drag-key]').forEach(el => {
      el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-left', 'drop-right');
    });
  };
  container.addEventListener('dragstart', e => {
    const item = e.target.closest('[data-drag-key]');
    if (!item || !container.contains(item)) return;
    dragKey = item.dataset.dragKey;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragKey); } catch (_) {}
  });
  container.addEventListener('dragend', () => { clearMarks(); dragKey = null; });
  container.addEventListener('dragover', e => {
    if (dragKey == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = e.target.closest('[data-drag-key]');
    container.querySelectorAll('[data-drag-key]').forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-left', 'drop-right'));
    if (!over || over.dataset.dragKey === dragKey) return;
    const rect = over.getBoundingClientRect();
    if (axis === 'x') {
      const before = (e.clientX - rect.left) < rect.width / 2;
      over.classList.add(before ? 'drop-left' : 'drop-right');
    } else {
      const before = (e.clientY - rect.top) < rect.height / 2;
      over.classList.add(before ? 'drop-before' : 'drop-after');
    }
  });
  container.addEventListener('drop', e => {
    if (dragKey == null) return;
    e.preventDefault();
    const over = e.target.closest('[data-drag-key]');
    if (!over || over.dataset.dragKey === dragKey) return;
    const rect = over.getBoundingClientRect();
    const before = axis === 'x'
      ? (e.clientX - rect.left) < rect.width / 2
      : (e.clientY - rect.top) < rect.height / 2;
    onReorder(dragKey, over.dataset.dragKey, before);
  });
}
