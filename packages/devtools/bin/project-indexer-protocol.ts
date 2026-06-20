import type { IndexPatch } from '@crux/indexer'
import {
  indexPatchToWorkerEventStream,
  projectIndexArtifactToWorkerEvent,
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexArtifactKind,
  type ProjectIndexArtifactMap,
  type ProjectIndexFactProducer,
  type ProjectIndexWorkerEvent,
} from '@crux/indexer/worker-protocol'

const projectIndexFactProducer = {
  name: '@crux/indexer/project-indexer',
  version: 'v2',
} as const satisfies ProjectIndexFactProducer

const projectIndexMaxFactsPerBatchByMethod = {
  indexProjectAst: 200,
  indexProjectSemantic: 100,
  indexProjectIncremental: 200,
} as const satisfies Record<ProjectIndexPatchMethod, number>

/** Patch-producing project-indexer request methods. */
export type ProjectIndexPatchMethod = 'indexProjectAst' | 'indexProjectSemantic' | 'indexProjectIncremental'

/** Async JSON-line writer used by the worker protocol helpers. */
export type ProjectIndexWorkerWriter = (value: unknown) => Promise<void>

/** Error context used to report request failures over the V2 stream. */
export type ProjectIndexWorkerErrorContext =
  | { kind: 'phase'; method: string; phase?: IndexPatch['phase'] }
  | { kind: 'artifact'; method: string; artifact?: ProjectIndexArtifactKind }

/** Minimal incremental result shape needed for V2 event emission. */
export interface ProjectIndexIncrementalEventResult {
  readonly patches: readonly IndexPatch[]
  readonly decision?: unknown
  readonly report?: unknown
}

/** Writes a complete V2 event sequence for one index patch. */
export async function writePatchEvents(
  write: ProjectIndexWorkerWriter,
  method: string,
  patch: IndexPatch,
): Promise<void> {
  for (const event of indexPatchToWorkerEventStream(patch, {
    transactionId: transactionIdForPatch(method, patch),
    producer: projectIndexFactProducer,
    maxFactsPerBatch: maxFactsPerBatchForMethod(method),
  })) {
    await write(event)
  }
}

/** Writes one typed JSON artifact through the V2 worker protocol. */
export async function writeArtifactEvent<TKind extends ProjectIndexArtifactKind>(
  write: ProjectIndexWorkerWriter,
  artifact: TKind,
  payload: ProjectIndexArtifactMap[TKind],
  root: string,
): Promise<void> {
  await write(
    projectIndexArtifactToWorkerEvent(artifact, payload, {
      root,
      transactionId: `artifact:${artifact}`,
    }),
  )
}

/** Writes all patches from an incremental indexing run as ordered V2 events. */
export async function writeIncrementalEvents(
  write: ProjectIndexWorkerWriter,
  result: ProjectIndexIncrementalEventResult,
): Promise<void> {
  for (let index = 0; index < result.patches.length; index += 1) {
    const patch = result.patches[index]
    if (!patch) continue
    const events = indexPatchToWorkerEventStream(patch, {
      transactionId: transactionIdForPatch(`indexProjectIncremental:${index}`, patch),
      producer: projectIndexFactProducer,
      maxFactsPerBatch: projectIndexMaxFactsPerBatchByMethod.indexProjectIncremental,
    })
    const isFinalPatch = index === result.patches.length - 1
    for (const event of events) {
      if (isFinalPatch && event.type === 'phase:done') {
        await write({
          ...event,
          summary: {
            ...event.summary,
            decision: result.decision,
            report: result.report,
          },
        })
      } else {
        await write(event)
      }
    }
  }
}

/** Writes a phase failure as a V2 worker event. */
export async function writeProjectIndexPhaseError(
  write: ProjectIndexWorkerWriter,
  method: string,
  phase: IndexPatch['phase'] | undefined,
  message: string,
): Promise<void> {
  const event: ProjectIndexWorkerEvent = {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'phase:error',
    transactionId: `error:${method}:${phase ?? 'unknown'}`,
    ...(phase ? { phase } : {}),
    error: { message },
  }
  await write(event)
}

/** Writes an artifact failure as a V2 worker event. */
export async function writeProjectIndexArtifactError(
  write: ProjectIndexWorkerWriter,
  method: string,
  artifact: ProjectIndexArtifactKind | undefined,
  message: string,
): Promise<void> {
  const event: ProjectIndexWorkerEvent = {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'artifact:error',
    transactionId: `error:${method}:${artifact ?? 'unknown'}`,
    ...(artifact ? { artifact } : {}),
    error: { message },
  }
  await write(event)
}

/** Returns the V2 error event context for a worker request method. */
export function errorContextForMethod(method: string | undefined): ProjectIndexWorkerErrorContext | undefined {
  switch (method) {
    case 'resolveProjectModel':
      return { kind: 'artifact', method, artifact: 'projectModel' }
    case 'inspectProjectConfig':
      return { kind: 'artifact', method, artifact: 'projectConfig' }
    case 'indexProjectAst':
    case 'indexProjectSemantic':
    case 'indexProjectIncremental':
      return { kind: 'phase', method, phase: phaseForMethod(method) }
    default:
      return undefined
  }
}

/** Asserts that the request uses the only supported Project Index worker protocol. */
export function assertProjectIndexWorkerProtocolV2(
  value: unknown,
): asserts value is typeof PROJECT_INDEX_WORKER_PROTOCOL_VERSION {
  if (value !== PROJECT_INDEX_WORKER_PROTOCOL_VERSION) {
    throw new Error(`project index worker protocol version ${PROJECT_INDEX_WORKER_PROTOCOL_VERSION} is required`)
  }
}

function transactionIdForPatch(method: string, patch: IndexPatch): string {
  return `${method}:${patch.phase}:${patch.startedAt}`
}

function phaseForMethod(method: ProjectIndexPatchMethod): IndexPatch['phase']
function phaseForMethod(method: string | undefined): IndexPatch['phase'] | undefined
function phaseForMethod(method: string | undefined): IndexPatch['phase'] | undefined {
  switch (method) {
    case 'indexProjectAst':
      return 'ast'
    case 'indexProjectSemantic':
      return 'semantic'
    case 'indexProjectIncremental':
      return 'ast'
    default:
      return undefined
  }
}

function maxFactsPerBatchForMethod(method: string): number {
  if (isProjectIndexPatchMethod(method)) return projectIndexMaxFactsPerBatchByMethod[method]
  return 100
}

function isProjectIndexPatchMethod(method: string): method is ProjectIndexPatchMethod {
  return method === 'indexProjectAst' || method === 'indexProjectSemantic' || method === 'indexProjectIncremental'
}
