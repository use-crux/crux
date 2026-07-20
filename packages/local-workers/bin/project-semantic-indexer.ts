#!/usr/bin/env tsx

/**
 * Stdio wrapper for semantic Project Index enrichment.
 *
 * Protocol: one JSON request per line on stdin, V2 NDJSON worker events on stdout.
 */

import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { type IndexPatchBudget, type SemanticBackendSelection, type SemanticSourceProfile } from '@use-crux/indexer'
import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { createSemanticIndexService } from '@use-crux/indexer/host/semantic'
import {
  assertProjectIndexWorkerProtocolV2,
  writePatchEvents,
  writeProjectIndexPhaseError,
  type ProjectIndexWorkerErrorContext,
} from './project-indexer-protocol'
import { createSemanticTimingCollector } from './project-indexer-semantic-timing'

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

const semanticService = createSemanticIndexService()
let pending = 0
let closing = false

type SemanticWorkerRequest = {
  method?: string
  protocolVersion?: unknown
  requestId?: string
  requestKind?: 'start' | 'previousIndex:definitions' | 'previousIndex:sources' | 'sourceProfile:batch' | 'done'
  root?: string
  configPath?: string
  projectName?: string
  semanticBudget?: IndexPatchBudget
  semanticBackend?: SemanticBackendSelection
  previousIndex?: ProjectIndexSnapshot
  previousIndexDefinitions?: ProjectIndexSnapshot['definitions']
  previousIndexSources?: ProjectIndexSnapshot['sources']
  files?: readonly string[]
  dependencyClosure?: readonly string[]
  sourceProfile?: SemanticSourceProfile
  sourceProfileFiles?: SemanticSourceProfile['files']
  cacheDisabled?: boolean
}

const chunkedRequests = new Map<string, SemanticWorkerRequest>()

function maybeExit(): void {
  if (closing && pending === 0) process.exit(0)
}

async function writeResponse(value: unknown): Promise<void> {
  const line = `${JSON.stringify(value)}\n`
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(line, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

rl.on('line', (line: string) => {
  pending += 1
  void handleLine(line).finally(() => {
    pending -= 1
    maybeExit()
  })
})

async function handleLine(line: string): Promise<void> {
  const streamError: ProjectIndexWorkerErrorContext = {
    kind: 'phase',
    method: 'indexProjectSemantic',
    phase: 'semantic',
  }
  try {
    const parsed = JSON.parse(line) as SemanticWorkerRequest
    const req = chunkedSemanticRequest(parsed)
    if (!req) return

    if (req.method !== 'indexProjectSemantic') {
      throw new Error(`unknown semantic worker method: ${req.method}`)
    }
    if (!req.root) throw new Error('indexProjectSemantic requires root')
    assertProjectIndexWorkerProtocolV2(req.protocolVersion)

    const semanticTimings = createSemanticTimingCollector()
    const patch =
      req.files && req.files.length > 0
        ? await semanticService.indexFiles({
            root: req.root,
            configPath: req.configPath,
            projectName: req.projectName,
            semanticBudget: req.semanticBudget,
            semanticBackend: req.semanticBackend,
            previousIndex: req.previousIndex,
            files: normalizeProjectFiles(req.root, req.files),
            dependencyClosure: req.dependencyClosure
              ? normalizeProjectFiles(req.root, req.dependencyClosure)
              : undefined,
            sourceProfile: req.sourceProfile ? normalizeSourceProfile(req.root, req.sourceProfile) : undefined,
            semanticInstrumentation: semanticTimings.instrumentation,
            semanticCache: req.cacheDisabled ? 'disabled' : undefined,
          })
        : await semanticService.indexProject({
            root: req.root,
            configPath: req.configPath,
            projectName: req.projectName,
            semanticBudget: req.semanticBudget,
            semanticBackend: req.semanticBackend,
            previousIndex: req.previousIndex,
            semanticInstrumentation: semanticTimings.instrumentation,
            semanticCache: req.cacheDisabled ? 'disabled' : undefined,
          })
    await writePatchEvents(writeResponse, 'indexProjectSemantic', patch, { timings: semanticTimings.summary() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[project-semantic-indexer] error: ${message}\n`)
    await writeProjectIndexPhaseError(writeResponse, streamError.method, streamError.phase, message)
  }
}

function chunkedSemanticRequest(req: SemanticWorkerRequest): SemanticWorkerRequest | undefined {
  if (!req.requestKind) return req
  if (!req.requestId) throw new Error('chunked semantic worker request requires requestId')
  switch (req.requestKind) {
    case 'start':
      chunkedRequests.set(req.requestId, {
        ...req,
        requestKind: undefined,
        previousIndex: req.previousIndex
          ? {
              ...req.previousIndex,
              definitions: [],
              sources: [],
            }
          : undefined,
        sourceProfile: req.sourceProfile ? { ...req.sourceProfile, files: [] } : undefined,
      })
      return undefined
    case 'previousIndex:definitions': {
      const pendingRequest = chunkedRequests.get(req.requestId)
      if (!pendingRequest) throw new Error(`semantic worker request ${req.requestId} did not start`)
      const previousIndex = pendingRequest.previousIndex
      if (!previousIndex) throw new Error(`semantic worker request ${req.requestId} has no previousIndex header`)
      chunkedRequests.set(req.requestId, {
        ...pendingRequest,
        previousIndex: {
          ...previousIndex,
          definitions: [...previousIndex.definitions, ...(req.previousIndexDefinitions ?? [])],
        },
      })
      return undefined
    }
    case 'previousIndex:sources': {
      const pendingRequest = chunkedRequests.get(req.requestId)
      if (!pendingRequest) throw new Error(`semantic worker request ${req.requestId} did not start`)
      const previousIndex = pendingRequest.previousIndex
      if (!previousIndex) throw new Error(`semantic worker request ${req.requestId} has no previousIndex header`)
      chunkedRequests.set(req.requestId, {
        ...pendingRequest,
        previousIndex: {
          ...previousIndex,
          sources: [...previousIndex.sources, ...(req.previousIndexSources ?? [])],
        },
      })
      return undefined
    }
    case 'sourceProfile:batch': {
      const pendingRequest = chunkedRequests.get(req.requestId)
      if (!pendingRequest) throw new Error(`semantic worker request ${req.requestId} did not start`)
      const sourceProfile = pendingRequest.sourceProfile
      if (!sourceProfile) throw new Error(`semantic worker request ${req.requestId} has no sourceProfile header`)
      chunkedRequests.set(req.requestId, {
        ...pendingRequest,
        sourceProfile: {
          ...sourceProfile,
          files: [...sourceProfile.files, ...(req.sourceProfileFiles ?? [])],
        },
      })
      return undefined
    }
    case 'done': {
      const completed = chunkedRequests.get(req.requestId)
      if (!completed) throw new Error(`semantic worker request ${req.requestId} did not start`)
      chunkedRequests.delete(req.requestId)
      return completed
    }
  }
}

function normalizeProjectFiles(root: string, files: readonly string[]): readonly string[] {
  return [...new Set(files.map((file) => resolve(root, file)))].sort()
}

function normalizeSourceProfile(root: string, sourceProfile: SemanticSourceProfile): SemanticSourceProfile {
  const files = sourceProfile.files
    .map((file) => ({ ...file, file: resolve(root, file.file) }))
    .sort((left, right) => left.file.localeCompare(right.file))
  return {
    ...sourceProfile,
    files,
    dependencyClosure: normalizeProjectFiles(root, sourceProfile.dependencyClosure),
  }
}

rl.on('close', () => {
  closing = true
  maybeExit()
})
