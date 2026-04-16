import { S } from './state.js';
import { escapeHtml, getOptions } from './utils.js';
import { emit } from './events.js';

// 日付値を YYYY-MM-DD に正規化(時刻部分や '/' を吸収)
function normDate(v) {
  if (v == null) return '';
  return String(v).slice(0, 10).replace(/\//g, '-');
}

// ===== Filters =====
export function applyFilters(rows) {
  return rows.filter(r => {
    for (const f of S.FILTER_DEFS) {
      const v = S.FILTER_VALUES[f.id];
      if (f.type === 'date_from') { if (v && normDate(r[f.field]) < normDate(v)) return false; }
      else if (f.type === 'date_to') { if (v && normDate(r[f.field]) > normDate(v)) return false; }
      else if (f.type === 'multi') { if (v instanceof Set && v.size && !v.has(r[f.field])) return false; }
    }
    return true;
  });
}

export function renderFilters() {
  const el = document.getElementById('filters');
  if (!el) return;
  el.innerHTML = S.FILTER_DEFS.map(f => {
    if (f.type === 'multi') {
      return `<div><label>${escapeHtml(f.label)}</label>
        <div class="ms" data-filter-id="${f.id}">
          <button type="button" class="ms-btn"><span class="ms-label">\u3059\u3079\u3066</span><span class="ms-caret">\u25be</span></button>
          <div class="ms-menu hidden">
            <div class="ms-actions">
              <button type="button" class="link-btn" data-ms-all>\u3059\u3079\u3066</button>
              <button type="button" class="link-btn" data-ms-clear>\u30af\u30ea\u30a2</button>
            </div>
            <div class="ms-options"></div>
          </div>
        </div>
      </div>`;
    }
    const val = S.FILTER_VALUES[f.id] || '';
    return `<div><label>${escapeHtml(f.label)}</label><input type="date" data-filter-id="${f.id}" value="${escapeHtml(val)}"></div>`;
  }).join('');
  S.FILTER_DEFS.forEach(f => {
    if (f.type === 'multi') {
      if (!(S.FILTER_VALUES[f.id] instanceof Set)) S.FILTER_VALUES[f.id] = new Set();
      setupMSDynamic(f);
    } else {
      if (S.FILTER_VALUES[f.id] == null) S.FILTER_VALUES[f.id] = '';
    }
  });
}

export function setupMSDynamic(f) {
  const root = document.querySelector(`[data-filter-id="${f.id}"]`);
  if (!root || !root.classList.contains('ms')) return;
  const btn = root.querySelector('.ms-btn');
  const menu = root.querySelector('.ms-menu');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.ms-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
    menu.classList.toggle('hidden');
  });
  menu.addEventListener('click', e => e.stopPropagation());
  menu.addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const set = S.FILTER_VALUES[f.id];
    if (cb.checked) set.add(cb.value);
    else set.delete(cb.value);
    cb.closest('.ms-option').classList.toggle('checked', cb.checked);
    updateMSLabelDyn(f);
    emit('render');
  });
  root.querySelector('[data-ms-all]').addEventListener('click', () => {
    getOptions(S.RAW, f.field).forEach(v => S.FILTER_VALUES[f.id].add(v));
    renderMSDynamic(f);
    emit('render');
  });
  root.querySelector('[data-ms-clear]').addEventListener('click', () => {
    S.FILTER_VALUES[f.id].clear();
    renderMSDynamic(f);
    emit('render');
  });
  renderMSDynamic(f);
}

export function renderMSDynamic(f) {
  const root = document.querySelector(`[data-filter-id="${f.id}"]`);
  if (!root) return;
  const menu = root.querySelector('.ms-options');
  const opts = getOptions(S.RAW, f.field);
  const set = S.FILTER_VALUES[f.id] || new Set();
  menu.innerHTML = opts.length
    ? opts.map(v => {
        const checked = set.has(v);
        return `<label class="ms-option${checked?' checked':''}"><input type="checkbox" value="${escapeHtml(v)}"${checked?' checked':''}>${escapeHtml(v)}</label>`;
      }).join('')
    : '<div class="add-menu-empty">\u30c7\u30fc\u30bf\u306a\u3057</div>';
  updateMSLabelDyn(f);
}

export function updateMSLabelDyn(f) {
  const root = document.querySelector(`[data-filter-id="${f.id}"]`);
  if (!root) return;
  const label = root.querySelector('.ms-label');
  const set = S.FILTER_VALUES[f.id] || new Set();
  if (set.size === 0) { label.textContent = '\u3059\u3079\u3066'; label.classList.remove('has-sel'); }
  else if (set.size <= 2) { label.textContent = [...set].join(', '); label.classList.add('has-sel'); }
  else { label.textContent = `${set.size}\u4ef6\u9078\u629e\u4e2d`; label.classList.add('has-sel'); }
}

export function populateFilters() {
  S.FILTER_DEFS.forEach(f => {
    if (f.type === 'multi') {
      if (!(S.FILTER_VALUES[f.id] instanceof Set)) S.FILTER_VALUES[f.id] = new Set();
      else S.FILTER_VALUES[f.id].clear();
      renderMSDynamic(f);
    } else {
      S.FILTER_VALUES[f.id] = '';
      const el = document.querySelector(`[data-filter-id="${f.id}"]`);
      if (el) el.value = '';
    }
  });
}
