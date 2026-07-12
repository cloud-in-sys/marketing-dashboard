// Backward-compat re-export shim. The real implementation lives in
// features/settings/ — split into per-tab modules (users, metrics, dimensions,
// filterDefs, defaults, groups) plus an index.js that orchestrates them.
export { setupSettingsEvents, exitSettingsMode, enterSettingsMode, renderCsvColumns,
  hasUnsavedSettingsChanges, confirmDiscardUnsavedChanges, discardAllDrafts } from './index.js';
