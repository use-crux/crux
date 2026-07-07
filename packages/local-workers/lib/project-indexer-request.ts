import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import type { SemanticBackendSelection } from '@use-crux/indexer'
import type {
  CheckStaticRulesInput,
  ExtractStaticEvidenceBatchInput,
  LoadStaticExtensionHostManifestInput,
} from '@use-crux/indexer/host/static-compat'

/** Chunk event names accepted by the Project Index worker request assembler. */
export type ProjectIndexWorkerRequestKind =
  | 'start'
  | 'previousIndex:definitions'
  | 'previousIndex:sources'
  | 'done'

/** JSON-line request envelope accepted by the Project Index worker. */
export interface ProjectIndexWorkerRequest {
  readonly method?: string
  readonly protocolVersion?: unknown
  readonly requestId?: string
  readonly requestKind?: ProjectIndexWorkerRequestKind
  readonly root?: string
  readonly configPath?: string
  readonly projectName?: string
  readonly resolutionMode?: unknown
  readonly previousIndex?: ProjectIndexSnapshot
  readonly previousIndexDefinitions?: ProjectIndexSnapshot['definitions']
  readonly previousIndexSources?: ProjectIndexSnapshot['sources']
  /** Native Project Index definitions used to generate runtime artifacts. */
  readonly definitions?: ProjectIndexSnapshot['definitions']
  readonly files?: readonly string[]
  readonly deletedFiles?: readonly string[]
  readonly mode?: string
  readonly semanticBackend?: SemanticBackendSelection
  readonly includeStaticCacheStatus?: boolean
  /** Runtime operation requested by `crux runtime` CLI commands. */
  readonly runtimeOperation?: string
  /** Runtime work id used by inspect/retry/cancel operations. */
  readonly runtimeWorkId?: string
  /** Include bounded work/timer/outbox rows in runtime status responses. */
  readonly runtimeIncludeDetails?: boolean
  /** Native compiler protocol version supported by a manifest-loading caller. */
  readonly nativeCompilerProtocolVersion?: LoadStaticExtensionHostManifestInput['nativeCompilerProtocolVersion']
  /** Static Index evidence jobs forwarded to the TypeScript compatibility host. */
  readonly jobs?: ExtractStaticEvidenceBatchInput['jobs']
  /** Native-finalized graph facts forwarded to TypeScript index rules. */
  readonly graph?: CheckStaticRulesInput['graph']
  /** Optional auxiliary facts available to TypeScript index rules. */
  readonly availableFacts?: CheckStaticRulesInput['availableFacts']
  readonly maxAffectedFiles?: number
}

export type ProjectIndexWorkerRequestAssembler = (
  req: ProjectIndexWorkerRequest,
) => Promise<ProjectIndexWorkerRequest | undefined>

interface PendingProjectIndexWorkerRequest {
  readonly request: ProjectIndexWorkerRequest
}

/**
 * Creates an isolated request assembler for the Project Index worker stream.
 *
 * Go can send large requests as multiple JSON lines while the compiler-facing
 * TypeScript API continues to receive one complete request object.
 */
export function createProjectIndexWorkerRequestAssembler(): ProjectIndexWorkerRequestAssembler {
  const chunkedRequests = new Map<string, PendingProjectIndexWorkerRequest>()
  return (req) => assembleProjectIndexWorkerRequest(chunkedRequests, req)
}

async function assembleProjectIndexWorkerRequest(
  chunkedRequests: Map<string, PendingProjectIndexWorkerRequest>,
  req: ProjectIndexWorkerRequest,
): Promise<ProjectIndexWorkerRequest | undefined> {
  if (!req.requestKind) return req
  if (!req.requestId) throw new Error('chunked project index worker request requires requestId')
  switch (req.requestKind) {
    case 'start': {
      chunkedRequests.set(req.requestId, {
        request: {
          ...req,
          requestKind: undefined,
          previousIndex: req.previousIndex
            ? {
                ...req.previousIndex,
                definitions: [],
                sources: [],
              }
            : undefined,
        },
      })
      return undefined
    }
    case 'previousIndex:definitions': {
      const pendingRequest = requirePendingProjectIndexRequest(chunkedRequests, req.requestId)
      const previousIndex = pendingRequest.request.previousIndex
      if (!previousIndex) throw new Error(`project index worker request ${req.requestId} has no previousIndex header`)
      chunkedRequests.set(req.requestId, {
        ...pendingRequest,
        request: {
          ...pendingRequest.request,
          previousIndex: {
            ...previousIndex,
            definitions: [...previousIndex.definitions, ...(req.previousIndexDefinitions ?? [])],
          },
        },
      })
      return undefined
    }
    case 'previousIndex:sources': {
      const pendingRequest = requirePendingProjectIndexRequest(chunkedRequests, req.requestId)
      const previousIndex = pendingRequest.request.previousIndex
      if (!previousIndex) throw new Error(`project index worker request ${req.requestId} has no previousIndex header`)
      chunkedRequests.set(req.requestId, {
        ...pendingRequest,
        request: {
          ...pendingRequest.request,
          previousIndex: {
            ...previousIndex,
            sources: [...previousIndex.sources, ...(req.previousIndexSources ?? [])],
          },
        },
      })
      return undefined
    }
    case 'done': {
      const completed = requirePendingProjectIndexRequest(chunkedRequests, req.requestId)
      chunkedRequests.delete(req.requestId)
      return completed.request
    }
  }
}

function requirePendingProjectIndexRequest(
  chunkedRequests: Map<string, PendingProjectIndexWorkerRequest>,
  requestId: string,
): PendingProjectIndexWorkerRequest {
  const pendingRequest = chunkedRequests.get(requestId)
  if (!pendingRequest) throw new Error(`project index worker request ${requestId} did not start`)
  return pendingRequest
}
