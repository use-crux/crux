/**
 * Static Syntax evidence APIs for Indexer Extensions.
 *
 * This boundary exposes AST-free evidence readers and the bounded static
 * extension host that runs evidence extractors over parser-owned syntax records.
 *
 * @module
 */

export { createStaticRecordEvidenceReader, type StaticRecordEvidenceReaderInput } from './record-reader'
export {
  checkStaticRules,
  extractStaticEvidenceBatch,
  loadStaticExtensionHostManifest,
  type CheckStaticRulesInput,
  type CheckStaticRulesResult,
  type ExtractStaticEvidenceBatchInput,
  type ExtractStaticEvidenceBatchItemResult,
  type ExtractStaticEvidenceBatchResult,
  type LoadStaticExtensionHostManifestInput,
  type LoadStaticExtensionHostManifestResult,
  type StaticExtensionEvidenceExtractor,
  type StaticExtensionEvidenceJob,
  type StaticExtensionHostMethod,
  type StaticExtensionHostNodeReason,
  type StaticExtensionHostNodeReport,
  type StaticExtensionHostRuntimeInput,
  type StaticRuleGraphInput,
} from './host'
export {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
  loadStaticExtensionHostManifestForProject,
  type CheckStaticRulesForProjectInput,
  type ExtractStaticEvidenceBatchForProjectInput,
  type LoadStaticExtensionHostManifestForProjectInput,
  type StaticExtensionWorkerProjectInput,
} from './worker'
export { staticInterestManifestFromExtensions } from './interests'
export type { StaticExtensionNativeFinalizeFacts, StaticExtensionNativeRelationRef } from './host-facts'
export type {
  StaticCallbackInterest,
  StaticCallbackSummary,
  StaticCallbackSummaryInput,
  StaticCallEvidenceQuery,
  StaticCallInterest,
  StaticConstructorEvidenceQuery,
  StaticConstructorInterest,
  StaticEvidenceCompatibility,
  StaticEvidenceInterestManifest,
  StaticEvidenceInterestSource,
  StaticEvidenceKind,
  StaticEvidenceMode,
  StaticEvidenceReader,
  StaticMatchEvidence,
} from './types'

