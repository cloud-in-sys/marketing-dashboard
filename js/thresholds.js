// ===== THRESHOLDS =====
import { S } from './state.js';
import { emit, on } from './events.js';

function toDisplayThreshold(v, fmt) {
  if (v == null) return '';
  return fmt === 'pct' ? v * 100 : v;
}
function fromDisplayThreshold(v, fmtType) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return fmtType === 'pct' ? n / 100 : n;
}

function renderThresholds() {
  const el = document.getElementById('threshold-list');
  const head = document.getElementById('threshold-head');
  if (!S.THRESHOLD_METRICS.length) {
    head.classList.add('hidden');
    el.innerHTML = '<div class="threshold-empty">右上の「+ 指標を追加」から指標を選んでください</div>';
  } else {
    head.classList.remove('hidden');
    el.innerHTML = S.THRESHOLD_METRICS.map(k => {
      const m = S.METRIC_DEFS.find(x => x.key === k);
      if (!m) return '';
      const t = S.THRESHOLDS[k] || {};
      const unit = m.fmt === 'yen' ? '¥' : m.fmt === 'pct' ? '%' : '';
      const opMin = t.minOp || '<=';
      const opMax = t.maxOp || '<=';
      const opTarget = t.targetOp || '>=';
      const opSelect = (role, val) => `<select class="threshold-op" data-role="${role}Op">
        <option value="<"${val==='<'?' selected':''}>&lt; (未満)</option>
        <option value="<="${val==='<='?' selected':''}>&le; (以下)</option>
        <option value=">"${val==='>'?' selected':''}>&gt; (超)</option>
        <option value=">="${val==='>='?' selected':''}>&ge; (以上)</option>
      </select>`;
      return `<div class="threshold-row" data-key="${k}">
        <div class="threshold-label">${m.label}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
        ${opSelect('min', opMin)}
        <input type="number" step="any" data-role="min" placeholder="—" value="${toDisplayThreshold(t.min, m.fmt)}">
        ${opSelect('max', opMax)}
        <input type="number" step="any" data-role="max" placeholder="—" value="${toDisplayThreshold(t.max, m.fmt)}">
        ${opSelect('target', opTarget)}
        <input type="number" step="any" data-role="target" placeholder="—" value="${toDisplayThreshold(t.target, m.fmt)}">
        <button type="button" class="threshold-remove" data-remove="${k}" aria-label="削除">×</button>
      </div>`;
    }).join('');
  }
  const menu = document.getElementById('threshold-add-menu');
  const avail = S.METRIC_DEFS.filter(m => !S.THRESHOLD_METRICS.includes(m.key));
  menu.innerHTML = avail.length
    ? avail.map(m => `<button type="button" class="add-menu-item" data-add="${m.key}">${m.label}</button>`).join('')
    : '<div class="add-menu-empty">追加できる指標はありません</div>';
}

on('renderThresholds', renderThresholds);

// ===== THRESHOLDS EVENT HANDLERS =====
document.getElementById('threshold-list').addEventListener('input', e => {
  const row = e.target.closest('.threshold-row');
  if (!row) return;
  const key = row.dataset.key;
  const role = e.target.dataset.role;
  if (!role) return;
  if (!S.THRESHOLDS[key]) S.THRESHOLDS[key] = {};
  if (role.endsWith('Op')) {
    S.THRESHOLDS[key][role] = e.target.value;
  } else {
    const mdef = S.METRIC_DEFS.find(m => m.key === key);
    if (!mdef) return;
    const raw = fromDisplayThreshold(e.target.value, mdef.fmt);
    if (raw == null) delete S.THRESHOLDS[key][role];
    else S.THRESHOLDS[key][role] = raw;
  }
  emit('render');
});
document.getElementById('threshold-list').addEventListener('change', e => {
  const row = e.target.closest('.threshold-row');
  if (!row) return;
  const key = row.dataset.key;
  const role = e.target.dataset.role;
  if (!role || !role.endsWith('Op')) return;
  if (!S.THRESHOLDS[key]) S.THRESHOLDS[key] = {};
  S.THRESHOLDS[key][role] = e.target.value;
  emit('render');
});
document.getElementById('threshold-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const key = btn.dataset.remove;
  S.THRESHOLD_METRICS = S.THRESHOLD_METRICS.filter(k => k !== key);
  delete S.THRESHOLDS[key];
  renderThresholds();
  emit('render');
});
document.getElementById('threshold-add-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('threshold-add-menu').classList.toggle('hidden');
});
document.getElementById('threshold-add-menu').addEventListener('click', e => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const key = btn.dataset.add;
  if (!S.THRESHOLD_METRICS.includes(key)) S.THRESHOLD_METRICS.push(key);
  document.getElementById('threshold-add-menu').classList.add('hidden');
  renderThresholds();
  emit('render');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#threshold-add-btn') && !e.target.closest('#threshold-add-menu')) {
    document.getElementById('threshold-add-menu').classList.add('hidden');
  }
});
document.getElementById('threshold-clear').addEventListener('click', () => {
  S.THRESHOLDS = {};
  S.THRESHOLD_METRICS = [];
  renderThresholds();
  emit('render');
});
