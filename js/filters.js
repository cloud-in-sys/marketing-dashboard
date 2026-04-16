import { S } from './state.js';
import { escapeHtml, getOptions } from './utils.js';
import { emit } from './events.js';

// 日付値を YYYY-MM-DD に正規化(時刻部分や '/' を吸収)
function normDate(v) {
  if (v == null) return '';
  return String(v).slice(0, 10).replace(/\//g, '-');
}

// ===== 条件フィルタのマッチ判定 =====
function matchCondition(cellVal, op, condVal) {
  if (!condVal && condVal !== 0) return true;
  const s = String(cellVal ?? '');
  const c = String(condVal);
  switch (op) {
    case 'contains':    return s.includes(c);
    case 'notContains': return !s.includes(c);
    case 'equals':      return s === c;
    case 'notEquals':   return s !== c;
    case 'startsWith':  return s.startsWith(c);
    case 'endsWith':    return s.endsWith(c);
    case 'gt':          return Number(s) > Number(c);
    case 'gte':         return Number(s) >= Number(c);
    case 'lt':          return Number(s) < Number(c);
    case 'lte':         return Number(s) <= Number(c);
    case 'empty':       return s === '';
    case 'notEmpty':    return s !== '';
    default:            return true;
  }
}

// ===== Filters =====
export function applyFilters(rows) {
  return rows.filter(r => {
    for (const f of S.FILTER_DEFS) {
      const v = S.FILTER_VALUES[f.id];
      if (f.type === 'date_from') { if (v && normDate(r[f.field]) < normDate(v)) return false; }
      else if (f.type === 'date_to') { if (v && normDate(r[f.field]) > normDate(v)) return false; }
      else if (f.type === 'multi') {
        // 値フィルタ
        if (v instanceof Set && v.size && !v.has(r[f.field])) return false;
        // 条件フィルタ
        const cond = S.FILTER_CONDITIONS?.[f.id];
        if (cond && cond.op && cond.op !== 'none') {
          if (!matchCondition(r[f.field], cond.op, cond.value)) return false;
        }
      }
    }
    return true;
  });
}

export function renderFilters() {
  const el = document.getElementById('filters');
  if (!el) return;
  if (!S.FILTER_CONDITIONS) S.FILTER_CONDITIONS = {};
  el.innerHTML = S.FILTER_DEFS.map(f => {
    if (f.type === 'multi') {
      return `<div><label>${escapeHtml(f.label)}</label>
        <div class="ms" data-filter-id="${f.id}">
          <button type="button" class="ms-btn"><span class="ms-label">すべて</span><span class="ms-caret">▾</span></button>
          <div class="ms-menu hidden">
            <div class="ms-section">
              <button type="button" class="ms-section-toggle" data-toggle="condition">▶ 条件でフィルタ</button>
              <div class="ms-condition hidden" data-section="condition">
                <select class="ms-cond-op" data-cond-op>
                  <option value="none">なし</option>
                  <option value="contains">次を含むテキスト</option>
                  <option value="notContains">次を含まないテキスト</option>
                  <option value="equals">完全一致</option>
                  <option value="notEquals">不一致</option>
                  <option value="startsWith">先頭が一致</option>
                  <option value="endsWith">末尾が一致</option>
                  <option value="gt">次より大きい</option>
                  <option value="gte">以上</option>
                  <option value="lt">次より小さい</option>
                  <option value="lte">以下</option>
                  <option value="empty">空白</option>
                  <option value="notEmpty">空白以外</option>
                </select>
                <input type="text" class="ms-cond-val" data-cond-val placeholder="値" />
              </div>
            </div>
            <div class="ms-section">
              <button type="button" class="ms-section-toggle active" data-toggle="values">▼ 値でフィルタ</button>
              <div class="ms-values-section" data-section="values">
                <div class="ms-actions">
                  <button type="button" class="link-btn" data-ms-all>すべて選択</button>
                  <span class="ms-actions-sep">-</span>
                  <button type="button" class="link-btn" data-ms-clear>クリア</button>
                </div>
                <div class="ms-search-wrap">
                  <input type="text" class="ms-search" placeholder="検索..." />
                  <span class="ms-search-icon">🔍</span>
                </div>
                <div class="ms-options"></div>
              </div>
            </div>
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
      if (!S.FILTER_CONDITIONS[f.id]) S.FILTER_CONDITIONS[f.id] = { op: 'none', value: '' };
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

  // メニュー開閉
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.ms-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
    menu.classList.toggle('hidden');
  });
  menu.addEventListener('click', e => e.stopPropagation());

  // セクション開閉（条件/値）
  menu.querySelectorAll('.ms-section-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const target = toggle.dataset.toggle;
      const section = menu.querySelector(`[data-section="${target}"]`);
      const isOpen = !section.classList.contains('hidden');
      section.classList.toggle('hidden', isOpen);
      toggle.classList.toggle('active', !isOpen);
      toggle.textContent = (!isOpen ? '▼ ' : '▶ ') + (target === 'condition' ? '条件でフィルタ' : '値でフィルタ');
    });
  });

  // 条件フィルタ
  const condOp = menu.querySelector('[data-cond-op]');
  const condVal = menu.querySelector('[data-cond-val]');
  const cond = S.FILTER_CONDITIONS[f.id];
  if (cond.op !== 'none') {
    condOp.value = cond.op;
    condVal.value = cond.value || '';
  }
  // empty/notEmpty は値入力不要
  condOp.addEventListener('change', () => {
    const op = condOp.value;
    condVal.classList.toggle('hidden', op === 'empty' || op === 'notEmpty' || op === 'none');
    S.FILTER_CONDITIONS[f.id] = { op, value: condVal.value };
    updateMSLabelDyn(f);
    emit('render');
  });
  condVal.addEventListener('input', () => {
    S.FILTER_CONDITIONS[f.id].value = condVal.value;
    emit('render');
  });
  condVal.classList.toggle('hidden', cond.op === 'empty' || cond.op === 'notEmpty' || cond.op === 'none');

  // 値フィルタ: チェックボックス
  menu.addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb || cb.classList.contains('ms-cond-op')) return;
    const set = S.FILTER_VALUES[f.id];
    if (cb.checked) set.add(cb.value);
    else set.delete(cb.value);
    cb.closest('.ms-option')?.classList.toggle('checked', cb.checked);
    updateMSLabelDyn(f);
    emit('render');
  });

  // 全選択/クリア
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

  // 検索
  const searchInput = menu.querySelector('.ms-search');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    menu.querySelectorAll('.ms-option').forEach(opt => {
      const text = opt.textContent.toLowerCase();
      opt.style.display = text.includes(q) ? '' : 'none';
    });
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
        return `<label class="ms-option${checked ? ' checked' : ''}"><input type="checkbox" value="${escapeHtml(v)}"${checked ? ' checked' : ''}><span>${escapeHtml(v)}</span></label>`;
      }).join('')
    : '<div class="add-menu-empty">データなし</div>';
  updateMSLabelDyn(f);
}

export function updateMSLabelDyn(f) {
  const root = document.querySelector(`[data-filter-id="${f.id}"]`);
  if (!root) return;
  const label = root.querySelector('.ms-label');
  const set = S.FILTER_VALUES[f.id] || new Set();
  const cond = S.FILTER_CONDITIONS?.[f.id];
  const hasCond = cond && cond.op && cond.op !== 'none';
  if (set.size === 0 && !hasCond) { label.textContent = 'すべて'; label.classList.remove('has-sel'); }
  else {
    const parts = [];
    if (hasCond) parts.push('条件あり');
    if (set.size > 0 && set.size <= 2) parts.push([...set].join(', '));
    else if (set.size > 2) parts.push(`${set.size}件選択中`);
    label.textContent = parts.join(' / ');
    label.classList.add('has-sel');
  }
}

export function populateFilters() {
  S.FILTER_DEFS.forEach(f => {
    if (f.type === 'multi') {
      if (!(S.FILTER_VALUES[f.id] instanceof Set)) S.FILTER_VALUES[f.id] = new Set();
      else S.FILTER_VALUES[f.id].clear();
      if (S.FILTER_CONDITIONS?.[f.id]) S.FILTER_CONDITIONS[f.id] = { op: 'none', value: '' };
      renderMSDynamic(f);
    } else {
      S.FILTER_VALUES[f.id] = '';
      const el = document.querySelector(`[data-filter-id="${f.id}"]`);
      if (el) el.value = '';
    }
  });
}
