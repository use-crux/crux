/**
 * Canonical TypeScript contract for Project Index worker events.
 *
 * The worker event stream is the durable host boundary between TypeScript
 * compiler workers and local runtime hosts. This module re-exports the
 * existing event contracts from one visible contract-spine path while the
 * implementation remains in `indexer/worker-protocol`.
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
} from '../../worker-protocol'
export {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  factEnvelopesFromIndexPatch,
  indexPatchFromWorkerEvents,
  indexPatchToWorkerEventStream,
  indexPatchToWorkerEvents,
  projectIndexArtifactToWorkerEvent,
} from '../../worker-protocol'
