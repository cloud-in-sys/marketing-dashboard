// Backward-compat re-export shim. The real implementation lives in
// js/settings/ — split into per-tab modules (users, metrics, dimensions,
// filterDefs, defaults, groups) plus an index.js that orchestrates them.
export { setupSettingsEvents, exitSettingsMode, enterSettingsMode, renderCsvColumns } from './settings/index.js';
