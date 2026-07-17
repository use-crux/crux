/**
 * Index v2 — public surface.
 *
 * The master–detail Library/Index browser + architecture graph, wired to
 * the live `/api/index` read model. See `Index v2 — Implementation
 * Handover` and the Index Design System for the contract this implements.
 */

export {
  buildIndex,
  type IndexIndex,
  type ViewDef,
  type HealthFinding,
  type HealthRuleDescriptor,
} from "./adapt";
export { IndexIndexProvider, useIndexIndex } from "./context";
export { IndexBrowser } from "./browser";
export { IndexDetail } from "./detail";
export { IndexGraph } from "./graph";
export { IndexingStatus } from "./kit";
export { WatchStatus, summarizeProjectIndexWatchStatus } from "./watch-status";
export {
  IndexHealthList,
  IndexHealthOverview,
  IndexHealthSection,
} from "./health";
export {
  storageInventoryForIndex,
  storageSummaryForDef,
  storageWarningsForDef,
} from "./storage";
export type {
  StorageInventoryItem,
  StorageReadModelSummary,
  StorageWarningSummary,
} from "./storage";
