import {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexArtifactChunkEvent,
  type ProjectIndexArtifactDoneEvent,
  type ProjectIndexArtifactKind,
  type ProjectIndexArtifactMap,
} from './types'
import { DEFAULT_PROJECT_INDEX_WORKER_EVENT_MAX_BYTES } from './event-batches'

/** Options for emitting a JSON artifact through the worker stream protocol. */
export interface ProjectIndexArtifactToWorkerEventOptions {
  /** Transaction id for this artifact response. */
  readonly transactionId: string
  /** Absolute project root that produced the artifact. */
  readonly root: string
  /**
   * Maximum serialized bytes per worker event.
   *
   * Larger artifacts are split into `artifact:chunk` events followed by a
   * terminal `artifact:done` marker.
   */
  readonly maxEventBytes?: number
}

/**
 * Wraps a JSON artifact in a typed V3 worker event.
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

/** Wraps a JSON artifact in one or more bounded worker stream events. */
export function projectIndexArtifactToWorkerEvents<TKind extends ProjectIndexArtifactKind>(
  artifact: TKind,
  payload: ProjectIndexArtifactMap[TKind],
  options: ProjectIndexArtifactToWorkerEventOptions,
): Array<ProjectIndexArtifactChunkEvent<TKind> | ProjectIndexArtifactDoneEvent<TKind>> {
  const single = projectIndexArtifactToWorkerEvent(artifact, payload, options)
  const maxEventBytes = Math.max(1, options.maxEventBytes ?? DEFAULT_PROJECT_INDEX_WORKER_EVENT_MAX_BYTES)
  if (serializedEventBytes(single) <= maxEventBytes) return [single]

  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
  const maxChunkBytes = Math.max(1, Math.floor(maxEventBytes / 3))
  const events: Array<ProjectIndexArtifactChunkEvent<TKind> | ProjectIndexArtifactDoneEvent<TKind>> = []
  for (let offset = 0, sequence = 0; offset < payloadBytes.length; offset += maxChunkBytes, sequence += 1) {
    events.push({
      protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
      type: 'artifact:chunk',
      transactionId: options.transactionId,
      artifact,
      root: options.root,
      sequence,
      encoding: 'base64',
      payloadChunk: payloadBytes.subarray(offset, offset + maxChunkBytes).toString('base64'),
    })
  }
  events.push({
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'artifact:done',
    transactionId: options.transactionId,
    artifact,
    root: options.root,
  })
  return events
}

function serializedEventBytes(event: unknown): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}
