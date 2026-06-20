import {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexArtifactDoneEvent,
  type ProjectIndexArtifactKind,
  type ProjectIndexArtifactMap,
} from './types'

/** Options for emitting a JSON artifact through the worker stream protocol. */
export interface ProjectIndexArtifactToWorkerEventOptions {
  /** Transaction id for this artifact response. */
  readonly transactionId: string
  /** Absolute project root that produced the artifact. */
  readonly root: string
}

/**
 * Wraps a JSON artifact in a typed V2 worker event.
 *
 * The generic artifact kind narrows the payload type, so callers cannot emit a
 * project config body as a project model response or vice versa.
 */
export function projectIndexArtifactToWorkerEvent<TKind extends ProjectIndexArtifactKind>(
  artifact: TKind,
  payload: ProjectIndexArtifactMap[TKind],
  options: ProjectIndexArtifactToWorkerEventOptions,
): ProjectIndexArtifactDoneEvent<TKind> {
  return {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'artifact:done',
    transactionId: options.transactionId,
    artifact,
    root: options.root,
    payload,
  }
}

