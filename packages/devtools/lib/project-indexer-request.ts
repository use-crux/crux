import type { ProjectIndexSnapshot } from '@crux/core/project-index'
import type {
  IncrementalExecutionMode,
  IndexProjectAstFromSyntaxRecordsOptions,
  SemanticBackendSelection,
} from '@crux/indexer'
import type { ProvidedStaticSyntaxRecordProvider, StaticParseCacheHit } from '@crux/indexer/host/static-index'
import type {
  CheckStaticRulesInput,
  ExtractStaticEvidenceBatchInput,
  LoadStaticExtensionHostManifestInput,
} from '@crux/indexer/host/static-compat'
import {
  createProjectIndexSyntaxRecordSpool,
  type ProjectIndexSyntaxRecordSpool,
} from './project-indexer-syntax-record-spool'

export type StaticSyntaxFileRecord = IndexProjectAstFromSyntaxRecordsOptions['records'][number]
export type StaticSyntaxFrontendIdentity = NonNullable<IndexProjectAstFromSyntaxRecordsOptions['frontendIdentity']>
export type NativeFactProjectionMode = NonNullable<IndexProjectAstFromSyntaxRecordsOptions['nativeFactProjection']>

/** Chunk event names accepted by the Project Index worker request assembler. */
export type ProjectIndexWorkerRequestKind =
  | 'start'
  | 'previousIndex:definitions'
  | 'previousIndex:sources'
  | 'syntaxRecords'
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
  readonly files?: readonly string[]
  readonly deletedFiles?: readonly string[]
  readonly mode?: IncrementalExecutionMode
  readonly semanticBackend?: SemanticBackendSelection
  /**
   * Complete syntax records for legacy one-line requests and completed
   * reassembled chunked requests.
   */
  readonly syntaxRecords?: readonly StaticSyntaxFileRecord[]
  /**
   * Transport-only syntax record slice. The worker writes these chunks to a
   * request-scoped provider before invoking the compiler API.
   */
  readonly syntaxRecordsBatch?: readonly StaticSyntaxFileRecord[]
  readonly includeStaticCacheStatus?: boolean
  /** Internal validated static cache hits supplied by the native parser plan. */
  readonly staticCacheHits?: readonly StaticParseCacheHit[]
  /** Internal native syntax-record fact lane requested by the host. */
  readonly nativeFactProjection?: NativeFactProjectionMode
  /** Native compiler protocol version supported by a manifest-loading caller. */
  readonly nativeCompilerProtocolVersion?: LoadStaticExtensionHostManifestInput['nativeCompilerProtocolVersion']
  /** Static Index evidence jobs forwarded to the TypeScript compatibility host. */
  readonly jobs?: ExtractStaticEvidenceBatchInput['jobs']
  /** Native-finalized graph facts forwarded to TypeScript index rules. */
  readonly graph?: CheckStaticRulesInput['graph']
  /** Optional auxiliary facts available to TypeScript index rules. */
  readonly availableFacts?: CheckStaticRulesInput['availableFacts']
  /** Native finalization owns lint config/suppression for rule outputs. */
  readonly nativeLintFinalize?: boolean
  /**
   * Internal, non-JSON syntax record provider attached after chunk assembly.
   */
  readonly syntaxRecordProvider?: ProvidedStaticSyntaxRecordProvider
  /** Internal cleanup hook for request-scoped temporary resources. */
  readonly cleanup?: () => Promise<void>
  /** Internal marker telling the worker that projection may run before chunk completion. */
  readonly liveSyntaxRecordProjection?: boolean
  readonly syntaxFrontendIdentity?: StaticSyntaxFrontendIdentity
  readonly maxAffectedFiles?: number
}

export type ProjectIndexWorkerRequestAssembler = (
  req: ProjectIndexWorkerRequest,
) => Promise<ProjectIndexWorkerRequest | undefined>

interface PendingProjectIndexWorkerRequest {
  readonly request: ProjectIndexWorkerRequest
  readonly syntaxRecordSpool?: ProjectIndexSyntaxRecordSpool
  readonly liveSyntaxRecordProjection?: boolean
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
      const liveSyntaxRecordProjection = liveSyntaxRecordProjectionEnabled(req)
      const syntaxRecordSpool =
        req.method === 'indexProjectAstFromSyntaxRecords'
          ? createProjectIndexSyntaxRecordSpool({ identity: req.syntaxFrontendIdentity })
          : undefined
      try {
        if (syntaxRecordSpool && req.syntaxRecords) await syntaxRecordSpool.writeBatch(req.syntaxRecords)
      } catch (error) {
        await syntaxRecordSpool?.dispose()
        throw error
      }
      chunkedRequests.set(req.requestId, {
        syntaxRecordSpool,
        liveSyntaxRecordProjection,
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
          syntaxRecords: req.method === 'indexProjectAstFromSyntaxRecords' ? undefined : req.syntaxRecords,
          syntaxRecordsBatch: undefined,
          syntaxRecordProvider: syntaxRecordSpool?.provider,
          cleanup: syntaxRecordSpool ? () => syntaxRecordSpool.dispose() : undefined,
          liveSyntaxRecordProjection,
        },
      })
      return liveSyntaxRecordProjection
        ? {
            ...req,
            requestKind: undefined,
            syntaxRecords: undefined,
            syntaxRecordsBatch: undefined,
            syntaxRecordProvider: syntaxRecordSpool?.provider,
            cleanup: syntaxRecordSpool ? () => syntaxRecordSpool.dispose() : undefined,
            liveSyntaxRecordProjection: true,
          }
        : undefined
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
    case 'syntaxRecords': {
      const pendingRequest = requirePendingProjectIndexRequest(chunkedRequests, req.requestId)
      if (pendingRequest.request.method !== 'indexProjectAstFromSyntaxRecords') {
        throw new Error(`project index worker request ${req.requestId} does not accept syntaxRecords chunks`)
      }
      if (!pendingRequest.syntaxRecordSpool) {
        throw new Error(`project index worker request ${req.requestId} has no syntax record spool`)
      }
      try {
        await pendingRequest.syntaxRecordSpool.writeBatch(req.syntaxRecordsBatch ?? [])
      } catch (error) {
        chunkedRequests.delete(req.requestId)
        await pendingRequest.syntaxRecordSpool.dispose()
        throw error
      }
      return undefined
    }
    case 'done': {
      const completed = requirePendingProjectIndexRequest(chunkedRequests, req.requestId)
      chunkedRequests.delete(req.requestId)
      completed.syntaxRecordSpool?.close()
      if (completed.liveSyntaxRecordProjection) return undefined
      return completed.request
    }
  }
}

function liveSyntaxRecordProjectionEnabled(req: ProjectIndexWorkerRequest): boolean {
  if (req.method !== 'indexProjectAstFromSyntaxRecords') return false
  const value = process.env.CRUX_INDEXER_LIVE_SYNTAX_PROJECTION?.toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

function requirePendingProjectIndexRequest(
  chunkedRequests: Map<string, PendingProjectIndexWorkerRequest>,
  requestId: string,
): PendingProjectIndexWorkerRequest {
  const pendingRequest = chunkedRequests.get(requestId)
  if (!pendingRequest) throw new Error(`project index worker request ${requestId} did not start`)
  return pendingRequest
}
