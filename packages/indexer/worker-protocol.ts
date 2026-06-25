/**
 * Project Index worker protocol entry point.
 *
 * This host-facing barrel re-exports the TypeScript-owned worker-event and
 * Static Index protocol schemas from the contract spine. Bundled Crux workers
 * and local runtime hosts should import this subpath instead of reaching into
 * compiler internals.
 *
 * @module
 */

export type {
  IndexPatchToWorkerEventsOptions,
  ProjectIndexArtifactDoneEvent,
  ProjectIndexArtifactErrorEvent,
  ProjectIndexArtifactKind,
  ProjectIndexArtifactMap,
  ProjectIndexArtifactToWorkerEventOptions,
  ProjectIndexFactEnvelope,
  ProjectIndexFactEnvelopeFor,
  ProjectIndexFactFidelity,
  ProjectIndexFactProducer,
  ProjectIndexPatchFactKind,
  ProjectIndexPatchFactMap,
  ProjectIndexPatchMetadata,
  ProjectIndexPhaseDoneEvent,
  ProjectIndexPhaseErrorEvent,
  ProjectIndexPhaseStartEvent,
  ProjectIndexPhaseSummary,
  ProjectIndexPhaseTiming,
  ProjectIndexWorkerEvent,
} from './indexer/contracts/worker-events/schema'
export {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  factEnvelopesFromIndexPatch,
  indexPatchFromWorkerEvents,
  indexPatchToWorkerEventStream,
  indexPatchToWorkerEvents,
  projectIndexArtifactToWorkerEvent,
} from './indexer/contracts/worker-events/schema'
export type {
  ParsedStaticIndexCompilerRequest,
  StaticIndexCompilerMethod,
  StaticIndexCompilerRequest,
  StaticIndexCompilerResponse,
  StaticIndexFileInput,
  StaticIndexParserCallInterest,
  StaticIndexParserCallbackInterest,
  StaticIndexParserConstructorInterest,
  StaticIndexPreparedPlan,
  StaticIndexRunIdentity,
  StaticIndexSourceFile,
  StaticIndexTelemetry,
} from './indexer/contracts/static-index/schema'
export {
  parseStaticIndexCompilerRequest,
  STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
  StaticIndexAnalyzeRequestSchema,
  StaticIndexAnalyzeResponseSchema,
  StaticIndexCompilerRequestSchema,
  StaticIndexCompilerResponseSchema,
  StaticIndexFileInputSchema,
  StaticIndexFinalizeRequestSchema,
  StaticIndexFinalizeResponseSchema,
  StaticIndexParserCallInterestSchema,
  StaticIndexParserCallbackInterestSchema,
  StaticIndexParserConstructorInterestSchema,
  StaticIndexPrepareRequestSchema,
  StaticIndexPrepareResponseSchema,
  StaticIndexPreparedPlanSchema,
  StaticIndexRunIdentitySchema,
  StaticIndexSourceFileSchema,
  StaticIndexTelemetrySchema,
} from './indexer/contracts/static-index/schema'
