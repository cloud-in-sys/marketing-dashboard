// ===== Drag-reorder helper =====
export function makeSortable(container, onReorder) {
  let dragKey = null;
  // dragstart の e.target は draggable な祖先 (= 行) で、実際のクリック子要素では
  // ない。ハンドル限定 drag を実現するため、mousedown でクリック起点を記録する。
  let mousedownTarget = null;
  const axis = container.dataset.sortAxis || 'y';
  const clearMarks = () => {
    container.querySelectorAll('[data-drag-key]').forEach(el => {
      el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-left', 'drop-right');
    });
  };
  container.addEventListener('mousedown', e => { mousedownTarget = e.target; }, true);
  container.addEventListener('dragstart', e => {
    const item = e.target.closest('[data-drag-key]');
    if (!item || !container.contains(item)) return;
    // インタラクティブ要素 (color picker) 起点の drag は弾く。data-drag-handle が
    // 無い container で picker クリックが drag に化けるのを防ぐ保険。
    if (mousedownTarget && mousedownTarget.closest && mousedownTarget.closest('dashboard-color-picker')) {
      e.preventDefault();
      return;
    }
    // 行内に [data-drag-handle] があれば、mousedown 起点がハンドル領域内
    // でない場合は drag を弾く。ハンドル指定が無い (旧式の row 全体 draggable)
    // 場合は従来通り全域許可。
    if (item.querySelector('[data-drag-handle]')) {
      if (!mousedownTarget || !mousedownTarget.closest || !mousedownTarget.closest('[data-drag-handle]')) {
        e.preventDefault();
        return;
      }
    }
    dragKey = item.dataset.dragKey;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragKey); } catch (_) {}
  });
  container.addEventListener('dragend', () => { clearMarks(); dragKey = null; mousedownTarget = null; });
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
