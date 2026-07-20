import type { IndexPatch } from '@use-crux/indexer'
import {
  indexPatchToWorkerEventStream,
  projectIndexArtifactToWorkerEvents,
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexArtifactKind,
  type ProjectIndexArtifactMap,
  type ProjectIndexFactProducer,
  type ProjectIndexPhaseTiming,
  type ProjectIndexWorkerEvent,
  type RuntimeArtifactFinding,
} from '@use-crux/indexer/contracts/worker-events'

export type { ProjectIndexFactProducer } from '@use-crux/indexer/contracts/worker-events'

const projectIndexFactProducer = {
  name: '@use-crux/indexer/project-indexer',
  version: 'v2',
} as const satisfies ProjectIndexFactProducer

const projectIndexMaxFactsPerBatchByMethod = {
  indexProjectSemantic: 100,
  indexProjectRuntime: 100,
} as const satisfies Record<ProjectIndexPatchMethod, number>

/** Patch-producing project-indexer request methods. */
export type ProjectIndexPatchMethod = 'indexProjectSemantic' | 'indexProjectRuntime'

/** Async JSON-line writer used by the worker protocol helpers. */
export type ProjectIndexWorkerWriter = (value: unknown) => Promise<void>

/** Error context used to report request failures over the V2 stream. */
export type ProjectIndexWorkerErrorContext =
  | { kind: 'phase'; method: string; phase?: IndexPatch['phase'] }
  | { kind: 'artifact'; method: string; artifact?: ProjectIndexArtifactKind }

/** Options for writing patch events from a concrete worker binary. */
export interface ProjectIndexPatchEventOptions {
  /**
   * Identifies the worker that produced the facts. Runtime-rich indexing uses
   * its own producer so stored evidence can be isolated from source indexing.
   */
  readonly producer?: ProjectIndexFactProducer
  /** Optional compiler timing buckets emitted for diagnostics and benchmarks. */
  readonly timings?: readonly ProjectIndexPhaseTiming[]
}

/** Writes a complete V2 event sequence for one index patch. */
export async function writePatchEvents(
  write: ProjectIndexWorkerWriter,
  method: string,
  patch: IndexPatch,
  options: ProjectIndexPatchEventOptions = {},
): Promise<void> {
  for (const event of indexPatchToWorkerEventStream(patch, {
    transactionId: transactionIdForPatch(method, patch),
    producer: options.producer ?? projectIndexFactProducer,
    maxFactsPerBatch: maxFactsPerBatchForMethod(method),
  })) {
    await write(withPatchEventTimings(event, options.timings))
  }
}

function withPatchEventTimings(
  event: ProjectIndexWorkerEvent,
  timings: readonly ProjectIndexPhaseTiming[] | undefined,
): ProjectIndexWorkerEvent {
  if (!timings || timings.length === 0 || event.type !== 'phase:done') return event
  return {
    ...event,
    summary: {
      ...event.summary,
      timings,
    },
  }
}

/** Writes one typed JSON artifact through the V2 worker protocol. */
export async function writeArtifactEvent<TKind extends ProjectIndexArtifactKind>(
  write: ProjectIndexWorkerWriter,
  artifact: TKind,
  payload: ProjectIndexArtifactMap[TKind],
  root: string,
): Promise<void> {
  for (const event of projectIndexArtifactToWorkerEvents(artifact, payload, {
    root,
    transactionId: `artifact:${artifact}`,
  })) {
    await write(event)
  }
}

/** Writes a phase failure as a V2 worker event. */
export async function writeProjectIndexPhaseError(
  write: ProjectIndexWorkerWriter,
  method: string,
  phase: IndexPatch['phase'] | undefined,
  message: string,
  code?: string,
  remediation?: string,
): Promise<void> {
  const event: ProjectIndexWorkerEvent = {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'phase:error',
    transactionId: `error:${method}:${phase ?? 'unknown'}`,
    ...(phase ? { phase } : {}),
    error: {
      message,
      ...(code ? { code } : {}),
      ...(remediation ? { remediation } : {}),
    },
  }
  await write(event)
}

/** Writes an artifact failure as a V2 worker event. */
export async function writeProjectIndexArtifactError(
  write: ProjectIndexWorkerWriter,
  method: string,
  artifact: ProjectIndexArtifactKind | undefined,
  message: string,
  code?: string,
  remediation?: string,
  findings?: readonly RuntimeArtifactFinding[],
): Promise<void> {
  const event: ProjectIndexWorkerEvent = {
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'artifact:error',
    transactionId: `error:${method}:${artifact ?? 'unknown'}`,
    ...(artifact ? { artifact } : {}),
    error: {
      message,
      ...(code ? { code } : {}),
      ...(remediation ? { remediation } : {}),
      ...(findings && findings.length > 0 ? { findings } : {}),
    },
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
    case 'inspectProjectStaticIndexConfig':
      return { kind: 'artifact', method, artifact: 'projectStaticIndexConfig' }
    case 'inspectProjectStaticSyntaxPlan':
      return { kind: 'artifact', method, artifact: 'projectStaticSyntaxPlan' }
    case 'loadStaticExtensionHostManifest':
      return {
        kind: 'artifact',
        method,
        artifact: 'staticExtensionHostManifest',
      }
    case 'extractStaticEvidenceBatch':
      return {
        kind: 'artifact',
        method,
        artifact: 'staticExtensionEvidenceBatch',
      }
    case 'checkStaticRules':
      return { kind: 'artifact', method, artifact: 'staticRuleCheck' }
    case 'generateRuntimeArtifacts':
      return { kind: 'artifact', method, artifact: 'runtimeArtifacts' }
    case 'createDeploymentManifest':
      return { kind: 'artifact', method, artifact: 'deploymentManifest' }
    case 'runRuntimeOperation':
      return { kind: 'artifact', method, artifact: 'runtimeOperation' }
    case 'runSetupOperation':
      return { kind: 'artifact', method, artifact: 'setupOperation' }
    case 'indexProjectSemantic':
    case 'indexProjectRuntime':
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
    case 'indexProjectSemantic':
      return 'semantic'
    case 'indexProjectRuntime':
      return 'runtime'
    default:
      return undefined
  }
}

function maxFactsPerBatchForMethod(method: string): number {
  if (isProjectIndexPatchMethod(method)) return projectIndexMaxFactsPerBatchByMethod[method]
  return 100
}

function isProjectIndexPatchMethod(method: string): method is ProjectIndexPatchMethod {
  return method === 'indexProjectSemantic' || method === 'indexProjectRuntime'
}
