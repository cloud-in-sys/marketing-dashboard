// ===== Sidebar / Panel collapse / Sidebar groups =====
import { SIDEBAR_KEY, PANELS_KEY, GROUPS_KEY } from './state.js';
import { emit } from './events.js';

// ===== STATE LOADING =====
export function loadState() {
  // Now handled by loadSourceConfig in state.js
}

// ===== SIDEBAR HELPERS =====
function getCollapsedPanels() {
  try { return new Set(JSON.parse(localStorage.getItem(PANELS_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function setCollapsedPanels(set) {
  try { localStorage.setItem(PANELS_KEY, JSON.stringify([...set])); } catch (e) {}
}
function initPanelCollapse() {
  const collapsed = getCollapsedPanels();
  document.querySelectorAll('.panel.collapsible').forEach(p => {
    if (collapsed.has(p.dataset.panel)) p.classList.add('collapsed');
  });
}
function getSidebarGroupState() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function setSidebarGroupState(s) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(s)); } catch (e) {}
}
function applySidebarGroupState() {
  const s = getSidebarGroupState();
  document.querySelectorAll('.sidebar-group').forEach(g => {
    g.classList.toggle('collapsed', !!s.collapsed?.[g.dataset.group]);
  });
}
function initSidebar() {
  const saved = localStorage.getItem(SIDEBAR_KEY);
  const collapsed = saved === null ? true : saved === '1';
  document.body.classList.toggle('sidebar-collapsed', collapsed);
}

// Panel collapse buttons (was in FILTERS, PANELS, FILE block)
document.querySelectorAll('.panel.collapsible .collapse-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const panel = btn.closest('.panel');
    panel.classList.toggle('collapsed');
    const set = getCollapsedPanels();
    if (panel.classList.contains('collapsed')) set.add(panel.dataset.panel);
    else { set.delete(panel.dataset.panel); setTimeout(() => emit('render'), 0); }
    setCollapsedPanels(set);
  });
});

// ===== SIDEBAR GROUPS =====
document.querySelectorAll('.sidebar-group .group-title').forEach(title => {
  title.addEventListener('click', () => {
    const group = title.closest('.sidebar-group');
    group.classList.toggle('collapsed');
    const s = getSidebarGroupState();
    s.collapsed = s.collapsed || {};
    s.collapsed[group.dataset.group] = group.classList.contains('collapsed');
    setSidebarGroupState(s);
  });
});

// ===== SIDEBAR TOGGLE =====
document.getElementById('toggle-sidebar').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  setTimeout(() => emit('render'), 230);
});

// ===== INITIALIZATION (UI-only init runs immediately) =====
initSidebar();
initPanelCollapse();
applySidebarGroupState();
