/**
 * Static Index compatibility-host facade.
 *
 * The Rust Static Index compiler can call back into bundled TypeScript workers
 * for trusted extension manifests, evidence extraction, and rule execution.
 * These helpers are JSON-safe process boundaries for Crux-owned workers, not
 * extension authoring APIs.
 *
 * @module
 */

export {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
} from '../indexer/static-index/extension-host/evidence/worker'
export {
  loadStaticExtensionHostManifestForProject,
} from '../indexer/static-index/extension-host'

export type {
  CheckStaticRulesForProjectInput,
  ExtractStaticEvidenceBatchForProjectInput,
  StaticExtensionWorkerProjectInput,
} from '../indexer/static-index/extension-host/evidence/worker'
export type {
  LoadStaticExtensionHostManifestForProjectInput,
  StaticIndexExtensionHostProjectInput,
} from '../indexer/static-index/extension-host'
export type {
  CheckStaticRulesInput,
  CheckStaticRulesResult,
  ExtractStaticEvidenceBatchInput,
  ExtractStaticEvidenceBatchResult,
  LoadStaticExtensionHostManifestInput,
  LoadStaticExtensionHostManifestResult,
} from '../indexer/static-index/extension-host/evidence/host'
