#!/usr/bin/env tsx

/**
 * Stdio wrapper for Project Index indexing.
 *
 * Protocol: one JSON request per line on stdin, V2 NDJSON worker events on stdout.
 */

import { createInterface } from 'node:readline'
import {
  indexProjectAst,
  indexProjectIncremental,
  inspectProjectConfig,
  resolveProjectModel,
  type IncrementalExecutionMode,
  type SemanticBackendSelection,
} from '@crux/indexer'
import {
  isProjectModelResolutionMode,
  type ProjectIndexSnapshot,
  type ProjectModelResolutionMode,
} from '@crux/core/project-index'
import {
  assertProjectIndexWorkerProtocolV2,
  errorContextForMethod,
  writeArtifactEvent,
  writeIncrementalEvents,
  writePatchEvents,
  writeProjectIndexArtifactError,
  writeProjectIndexPhaseError,
  type ProjectIndexWorkerErrorContext,
} from './project-indexer-protocol'

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

let pending = 0
let closing = false

type ProjectIndexWorkerRequest = {
  method?: string
  protocolVersion?: unknown
  requestId?: string
  requestKind?: 'start' | 'previousIndex:definitions' | 'previousIndex:sources' | 'done'
  root?: string
  configPath?: string
  projectName?: string
  resolutionMode?: unknown
  previousIndex?: ProjectIndexSnapshot
  previousIndexDefinitions?: ProjectIndexSnapshot['definitions']
  previousIndexSources?: ProjectIndexSnapshot['sources']
  files?: readonly string[]
  deletedFiles?: readonly string[]
  mode?: IncrementalExecutionMode
  semanticBackend?: SemanticBackendSelection
  maxAffectedFiles?: number
}

const chunkedRequests = new Map<string, ProjectIndexWorkerRequest>()

function maybeExit(): void {
  if (closing && pending === 0) process.exit(0)
}

async function writeResponse(value: unknown): Promise<void> {
  const line = JSON.stringify(value) + '\n'
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
  let streamError: ProjectIndexWorkerErrorContext | undefined
  try {
    const parsed = JSON.parse(line) as ProjectIndexWorkerRequest
    streamError = errorContextForMethod(parsed.method)
    const req = chunkedProjectIndexRequest(parsed)
    if (!req) return
    switch (req.method) {
      case 'resolveProjectModel': {
        if (!req.root) throw new Error('resolveProjectModel requires root')
        assertProjectIndexWorkerProtocolV2(req.protocolVersion)
        const projectModel = await resolveProjectModel({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          resolutionMode: requestResolutionMode(req.resolutionMode),
        })
        await writeArtifactEvent(writeResponse, 'projectModel', projectModel, req.root)
        break
      }
      case 'inspectProjectConfig': {
        if (!req.root) throw new Error('inspectProjectConfig requires root')
        assertProjectIndexWorkerProtocolV2(req.protocolVersion)
        const config = await inspectProjectConfig({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          resolutionMode: requestResolutionMode(req.resolutionMode),
        })
        await writeArtifactEvent(writeResponse, 'projectConfig', config, req.root)
        break
      }
      case 'indexProjectAst': {
        if (!req.root) throw new Error('indexProjectAst requires root')
        assertProjectIndexWorkerProtocolV2(req.protocolVersion)
        const patch = await indexProjectAst({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
        })
        await writePatchEvents(writeResponse, 'indexProjectAst', patch)
        break
      }
      case 'indexProjectIncremental': {
        if (!req.root) throw new Error('indexProjectIncremental requires root')
        if (!req.previousIndex) throw new Error('indexProjectIncremental requires previousIndex')
        assertProjectIndexWorkerProtocolV2(req.protocolVersion)
        const result = await indexProjectIncremental({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          previousIndex: req.previousIndex,
          files: req.files ?? [],
          deletedFiles: req.deletedFiles,
          mode: req.mode ?? 'ast',
          semanticBackend: req.semanticBackend,
          maxAffectedFiles: req.maxAffectedFiles,
        })
        await writeIncrementalEvents(writeResponse, result)
        break
      }
      default:
        await writeResponse({ error: `unknown method: ${req.method}` })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[project-indexer] error: ${message}\n`)
    if (streamError?.kind === 'phase') {
      await writeProjectIndexPhaseError(writeResponse, streamError.method, streamError.phase, message)
    } else if (streamError?.kind === 'artifact') {
      await writeProjectIndexArtifactError(writeResponse, streamError.method, streamError.artifact, message)
    } else {
      await writeResponse({ error: message })
    }
  }
}

function chunkedProjectIndexRequest(req: ProjectIndexWorkerRequest): ProjectIndexWorkerRequest | undefined {
  if (!req.requestKind) return req
  if (!req.requestId) throw new Error('chunked project index worker request requires requestId')
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
      })
      return undefined
    case 'previousIndex:definitions': {
      const pendingRequest = chunkedRequests.get(req.requestId)
      if (!pendingRequest) throw new Error(`project index worker request ${req.requestId} did not start`)
      const previousIndex = pendingRequest.previousIndex
      if (!previousIndex) throw new Error(`project index worker request ${req.requestId} has no previousIndex header`)
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
      if (!pendingRequest) throw new Error(`project index worker request ${req.requestId} did not start`)
      const previousIndex = pendingRequest.previousIndex
      if (!previousIndex) throw new Error(`project index worker request ${req.requestId} has no previousIndex header`)
      chunkedRequests.set(req.requestId, {
        ...pendingRequest,
        previousIndex: {
          ...previousIndex,
          sources: [...previousIndex.sources, ...(req.previousIndexSources ?? [])],
        },
      })
      return undefined
    }
    case 'done': {
      const completed = chunkedRequests.get(req.requestId)
      if (!completed) throw new Error(`project index worker request ${req.requestId} did not start`)
      chunkedRequests.delete(req.requestId)
      return completed
    }
  }
}

function requestResolutionMode(value: unknown): ProjectModelResolutionMode | undefined {
  return isProjectModelResolutionMode(value) ? value : undefined
}

rl.on('close', () => {
  closing = true
  maybeExit()
})
