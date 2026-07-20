#!/usr/bin/env tsx

/**
 * Stdio wrapper for explicit runtime-rich Project Index evidence.
 *
 * Protocol: one JSON request per line on stdin, V2 NDJSON worker events on
 * stdout. This worker intentionally exposes only runtime-rich indexing so
 * authored source imports remain isolated from source/config workers.
 */

import { createInterface } from 'node:readline'
import { indexProjectRuntimeForHost } from '@use-crux/indexer/host/runtime'
import { isUserImportTimeoutError } from '@use-crux/indexer/internal/user-import'
import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import {
  assertProjectIndexWorkerProtocolV2,
  writePatchEvents,
  writeProjectIndexPhaseError,
  type ProjectIndexFactProducer,
  type ProjectIndexWorkerErrorContext,
} from './project-indexer-protocol'

const projectRuntimeIndexFactProducer = {
  name: '@use-crux/indexer/project-runtime-indexer',
  version: 'v2',
} as const satisfies ProjectIndexFactProducer

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

type ProjectRuntimeWorkerRequest = {
  method?: string
  protocolVersion?: unknown
  requestId?: string
  requestKind?: 'start' | 'previousIndex:definitions' | 'previousIndex:sources' | 'done'
  root?: string
  configPath?: string
  projectName?: string
  previousIndex?: ProjectIndexSnapshot
  previousIndexDefinitions?: ProjectIndexSnapshot['definitions']
  previousIndexSources?: ProjectIndexSnapshot['sources']
}

const chunkedRequests = new Map<string, ProjectRuntimeWorkerRequest>()
let pending = 0
let closing = false

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
    const parsed = JSON.parse(line) as ProjectRuntimeWorkerRequest
    streamError = { kind: 'phase', method: parsed.method ?? 'indexProjectRuntime', phase: 'runtime' }
    const req = chunkedProjectRuntimeRequest(parsed)
    if (!req) return
    if (req.method !== 'indexProjectRuntime') {
      await writeResponse({ error: `unknown method: ${req.method}` })
      return
    }
    if (!req.root) throw new Error('indexProjectRuntime requires root')
    if (!req.previousIndex) throw new Error('indexProjectRuntime requires previousIndex')
    assertProjectIndexWorkerProtocolV2(req.protocolVersion)

    const patch = await indexProjectRuntimeForHost({
      root: req.root,
      configPath: req.configPath,
      projectName: req.projectName,
      previousIndex: req.previousIndex,
    })
    await writePatchEvents(writeResponse, 'indexProjectRuntime', patch, {
      producer: projectRuntimeIndexFactProducer,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[project-runtime-indexer] error: ${message}\n`)
    await writeProjectIndexPhaseError(writeResponse, streamError?.method ?? 'indexProjectRuntime', 'runtime', message)
    if (isUserImportTimeoutError(error)) process.exit(1)
  }
}

function chunkedProjectRuntimeRequest(req: ProjectRuntimeWorkerRequest): ProjectRuntimeWorkerRequest | undefined {
  if (!req.requestKind) return req
  if (!req.requestId) throw new Error('chunked project runtime worker request requires requestId')
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
    case 'previousIndex:definitions':
      appendPreviousIndexDefinitions(req)
      return undefined
    case 'previousIndex:sources':
      appendPreviousIndexSources(req)
      return undefined
    case 'done': {
      const completed = chunkedRequests.get(req.requestId)
      if (!completed) throw new Error(`project runtime worker request ${req.requestId} did not start`)
      chunkedRequests.delete(req.requestId)
      return completed
    }
  }
}

function appendPreviousIndexDefinitions(req: ProjectRuntimeWorkerRequest): void {
  const pendingRequest = pendingChunkedRequest(req)
  const previousIndex = pendingPreviousIndex(req, pendingRequest)
  chunkedRequests.set(req.requestId!, {
    ...pendingRequest,
    previousIndex: {
      ...previousIndex,
      definitions: [...previousIndex.definitions, ...(req.previousIndexDefinitions ?? [])],
    },
  })
}

function appendPreviousIndexSources(req: ProjectRuntimeWorkerRequest): void {
  const pendingRequest = pendingChunkedRequest(req)
  const previousIndex = pendingPreviousIndex(req, pendingRequest)
  chunkedRequests.set(req.requestId!, {
    ...pendingRequest,
    previousIndex: {
      ...previousIndex,
      sources: [...previousIndex.sources, ...(req.previousIndexSources ?? [])],
    },
  })
}

function pendingChunkedRequest(req: ProjectRuntimeWorkerRequest): ProjectRuntimeWorkerRequest {
  const pendingRequest = chunkedRequests.get(req.requestId!)
  if (!pendingRequest) throw new Error(`project runtime worker request ${req.requestId} did not start`)
  return pendingRequest
}

function pendingPreviousIndex(
  req: ProjectRuntimeWorkerRequest,
  pendingRequest: ProjectRuntimeWorkerRequest,
): ProjectIndexSnapshot {
  if (!pendingRequest.previousIndex) {
    throw new Error(`project runtime worker request ${req.requestId} has no previousIndex header`)
  }
  return pendingRequest.previousIndex
}

rl.on('close', () => {
  closing = true
  maybeExit()
})
