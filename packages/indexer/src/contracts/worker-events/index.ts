/**
 * Project Index worker event contract.
 *
 * This entry point is the host-visible spine for V3 Project Index worker
 * streams: phase lifecycle events, fact batches, source-profile batches, and
 * artifact events. Bundled workers and local runtime hosts import this module
 * instead of reaching into compiler implementation folders.
 *
 * @module
 */

export type {
  IndexPatchToWorkerEventsOptions,
  ProjectIndexArtifactChunkEvent,
  ProjectIndexArtifactDoneEvent,
  ProjectIndexArtifactErrorEvent,
  ProjectIndexArtifactKind,
  ProjectIndexArtifactMap,
  ProjectIndexArtifactToWorkerEventOptions,
  ProjectIndexFactEnvelope,
  ProjectIndexFactEnvelopeFor,
  ProjectIndexFactFidelity,
  ProjectIndexFactExtractorProvenance,
  ProjectIndexFactProvenance,
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
  RuntimeArtifactFinding,
} from './schema'
export {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  factEnvelopesFromIndexPatch,
  indexPatchFromWorkerEvents,
  indexPatchToWorkerEventStream,
  indexPatchToWorkerEvents,
  projectIndexArtifactToWorkerEvent,
  projectIndexArtifactToWorkerEvents,
} from './schema'
export {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from './fixtures'
