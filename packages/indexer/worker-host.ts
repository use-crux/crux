/**
 * Internal Project Index worker host helpers.
 *
 * This subpath is for Crux-owned worker binaries and local runtime bridges. It
 * exposes JSON-safe compatibility-host calls without expanding the public
 * extension authoring surface.
 *
 * @module
 */

export {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
  type CheckStaticRulesForProjectInput,
  type ExtractStaticEvidenceBatchForProjectInput,
  type StaticExtensionWorkerProjectInput,
} from './indexer/static-index/extension-host/evidence/worker'
export {
  loadStaticExtensionHostManifestForProject,
  type LoadStaticExtensionHostManifestForProjectInput,
  type StaticIndexExtensionHostProjectInput,
} from './indexer/static-index/extension-host'
export type {
  CheckStaticRulesInput,
  CheckStaticRulesResult,
  ExtractStaticEvidenceBatchInput,
  ExtractStaticEvidenceBatchResult,
  LoadStaticExtensionHostManifestInput,
  LoadStaticExtensionHostManifestResult,
} from './indexer/static-index/extension-host/evidence/host'
