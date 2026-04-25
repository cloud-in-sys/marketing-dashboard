// ===== Card UI events (split out of main.js) =====
import { emit } from './events.js';
import { S, saveState } from './state.js';
import { openCardSettings, closeCardSettings, renderCardSettingsPanel } from './cardsRender.js';

// ===== KPI CARDS =====
document.getElementById('add-card').addEventListener('click', () => {
  const firstMetric = S.METRIC_DEFS[0]?.key || '';
  S.CARDS.push({ id: S.CARD_ID_SEQ++, metric: firstMetric, label: '', subMetric: '', subLabel: '' });
  emit('render');
});
document.getElementById('cards-grid').addEventListener('click', e => {
  const card = e.target.closest('[data-card-id]');
  if (!card) return;
  const id = +card.dataset.cardId;
  if (e.target.closest('[data-card-role="remove"]')) {
    S.CARDS = S.CARDS.filter(c => c.id !== id);
    if (S.CARD_SETTINGS_ID === id) closeCardSettings();
    emit('render');
    return;
  }
  if (e.target.closest('[data-card-role="settings"]')) {
    openCardSettings(id);
  }
});
// インライン名前変更
document.getElementById('cards-grid').addEventListener('input', e => {
  const role = e.target.dataset.cardRole;
  if (role !== 'label') return;
  const card = e.target.closest('[data-card-id]');
  const c = S.CARDS.find(x => x.id === +card.dataset.cardId);
  if (!c) return;
  c.label = e.target.value;
  // ライブ再描画は重いので、フォーカス保持のため再描画はスキップ。値は state にのみ保存。
  saveState();
});
function onCardPanelChange(e) {
  const role = e.target.dataset.cardPanelRole;
  if (!role) return;
  const c = S.CARDS.find(x => x.id === S.CARD_SETTINGS_ID);
  if (!c) return;
  c[role] = e.target.value;
  emit('render');
}
document.getElementById('card-settings-body').addEventListener('input', onCardPanelChange);
document.getElementById('card-settings-body').addEventListener('change', onCardPanelChange);
document.getElementById('card-settings-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-card-panel-role="resetColors"]');
  if (!btn) return;
  const c = S.CARDS.find(x => x.id === S.CARD_SETTINGS_ID);
  if (!c) return;
  delete c.bgColor;
  delete c.textColor;
  delete c.labelColor;
  delete c.valueColor;
  delete c.subColor;
  emit('render');
  renderCardSettingsPanel();
});
document.getElementById('card-settings-close').addEventListener('click', closeCardSettings);
document.getElementById('card-settings-backdrop').addEventListener('click', closeCardSettings);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.CARD_SETTINGS_ID != null) closeCardSettings();
});

// ===== CARD DRAG REORDER =====
let CARD_DRAG_ID = null;
const cardsGrid = document.getElementById('cards-grid');
cardsGrid.addEventListener('dragstart', e => {
  if (e.target.closest('input, textarea, button')) { e.preventDefault(); return; }
  const card = e.target.closest('.kpi-card');
  if (!card) return;
  CARD_DRAG_ID = +card.dataset.cardId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(CARD_DRAG_ID)); } catch (_) {}
});
cardsGrid.addEventListener('dragend', () => {
  cardsGrid.querySelectorAll('.kpi-card').forEach(c => {
    c.classList.remove('dragging');
    c.classList.remove('drop-target');
  });
  CARD_DRAG_ID = null;
});
cardsGrid.addEventListener('dragover', e => {
  if (CARD_DRAG_ID == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.target.closest('.kpi-card');
  cardsGrid.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('drop-target'));
  if (card && +card.dataset.cardId !== CARD_DRAG_ID) card.classList.add('drop-target');
});
cardsGrid.addEventListener('drop', e => {
  if (CARD_DRAG_ID == null) return;
  e.preventDefault();
  const card = e.target.closest('.kpi-card');
  if (!card) return;
  const targetId = +card.dataset.cardId;
  if (targetId === CARD_DRAG_ID) return;
  const from = S.CARDS.findIndex(c => c.id === CARD_DRAG_ID);
  const to = S.CARDS.findIndex(c => c.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = S.CARDS.splice(from, 1);
  S.CARDS.splice(to, 0, moved);
  CARD_DRAG_ID = null;
  emit('render');
});
