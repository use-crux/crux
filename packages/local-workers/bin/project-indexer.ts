#!/usr/bin/env tsx

/**
 * Stdio wrapper for Project Index indexing.
 *
 * Protocol: one JSON request per line on stdin, V2 NDJSON worker events on stdout.
 */

import { createInterface } from 'node:readline'
import {
  indexProjectAst,
  indexProjectAstFromSyntaxRecordProvider,
  indexProjectAstFromSyntaxRecords,
  indexProjectIncremental,
  inspectProjectStaticIndexConfig,
  inspectProjectStaticSyntaxPlan,
  inspectProjectConfig,
  resolveProjectModel,
} from '@use-crux/indexer'
import { isProjectModelResolutionMode, type ProjectModelResolutionMode } from '@use-crux/core/project-index'
import {
  createProjectIndexWorkerRequestAssembler,
  type ProjectIndexWorkerRequest,
} from '../lib/project-indexer-request'
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
import { writeStaticHostArtifactRequest } from './project-indexer-static-host'
import { createStaticTimingCollector, providedRecordCacheSizeFromEnv } from './project-indexer-static-timing'

const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

let pending = 0
let closing = false
let lineQueue = Promise.resolve()
const liveProjectionRequests = new Map<string, Promise<void>>()

const assembleProjectIndexWorkerRequest = createProjectIndexWorkerRequestAssembler()

function maybeExit(): void {
  if (closing && pending === 0 && liveProjectionRequests.size === 0) process.exit(0)
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
  lineQueue = lineQueue
    .then(
      () => handleLine(line),
      () => handleLine(line),
    )
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[project-indexer] unhandled error: ${message}\n`)
    })
    .finally(() => {
      pending -= 1
      maybeExit()
    })
  void lineQueue
})

async function handleLine(line: string): Promise<void> {
  let streamError: ProjectIndexWorkerErrorContext | undefined
  try {
    const parsed = JSON.parse(line) as ProjectIndexWorkerRequest
    streamError = errorContextForMethod(parsed.method)
    const req = await assembleProjectIndexWorkerRequest(parsed)
    if (!req) {
      if (parsed.requestKind === 'done' && parsed.requestId) {
        const liveProjection = liveProjectionRequests.get(parsed.requestId)
        if (liveProjection) await liveProjection
      }
      return
    }
    if (req.liveSyntaxRecordProjection && req.requestId) {
      const liveProjection = runAssembledRequest(req, streamError).finally(() => {
        liveProjectionRequests.delete(req.requestId!)
        maybeExit()
      })
      liveProjectionRequests.set(req.requestId, liveProjection)
      return
    }
    await runAssembledRequest(req, streamError)
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

async function runAssembledRequest(
  req: ProjectIndexWorkerRequest,
  streamError: ProjectIndexWorkerErrorContext | undefined,
): Promise<void> {
  try {
    try {
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
        case 'inspectProjectStaticIndexConfig': {
          if (!req.root) throw new Error('inspectProjectStaticIndexConfig requires root')
          assertProjectIndexWorkerProtocolV2(req.protocolVersion)
          const config = await inspectProjectStaticIndexConfig({
            root: req.root,
            configPath: req.configPath,
          })
          await writeArtifactEvent(writeResponse, 'projectStaticIndexConfig', config, req.root)
          break
        }
        case 'inspectProjectStaticSyntaxPlan': {
          if (!req.root) throw new Error('inspectProjectStaticSyntaxPlan requires root')
          assertProjectIndexWorkerProtocolV2(req.protocolVersion)
          const plan = await inspectProjectStaticSyntaxPlan({
            root: req.root,
            configPath: req.configPath,
            projectName: req.projectName,
            resolutionMode: requestResolutionMode(req.resolutionMode),
            includeCacheStatus: req.includeStaticCacheStatus,
          })
          await writeArtifactEvent(writeResponse, 'projectStaticSyntaxPlan', plan, req.root)
          break
        }
        case 'loadStaticExtensionHostManifest':
        case 'extractStaticEvidenceBatch':
        case 'checkStaticRules': {
          assertProjectIndexWorkerProtocolV2(req.protocolVersion)
          await writeStaticHostArtifactRequest(writeResponse, req)
          break
        }
        case 'indexProjectAst': {
          if (!req.root) throw new Error('indexProjectAst requires root')
          assertProjectIndexWorkerProtocolV2(req.protocolVersion)
          const staticTimings = createStaticTimingCollector()
          const patch = await indexProjectAst({
            root: req.root,
            configPath: req.configPath,
            projectName: req.projectName,
            staticInstrumentation: staticTimings.instrumentation,
          })
          await writePatchEvents(writeResponse, 'indexProjectAst', patch, { timings: staticTimings.summary() })
          break
        }
        case 'indexProjectAstFromSyntaxRecords': {
          if (!req.root) throw new Error('indexProjectAstFromSyntaxRecords requires root')
          assertProjectIndexWorkerProtocolV2(req.protocolVersion)
          const staticTimings = createStaticTimingCollector()
          const patch = req.syntaxRecordProvider
            ? await indexProjectAstFromSyntaxRecordProvider({
                root: req.root,
                configPath: req.configPath,
                projectName: req.projectName,
                recordProvider: req.syntaxRecordProvider,
                frontendIdentity: req.syntaxFrontendIdentity,
                staticCacheHits: req.staticCacheHits,
                staticInstrumentation: staticTimings.instrumentation,
                providedRecordCacheSize: providedRecordCacheSizeFromEnv(),
                nativeFactProjection: req.nativeFactProjection,
              })
            : await indexProjectAstFromSyntaxRecords({
                root: req.root,
                configPath: req.configPath,
                projectName: req.projectName,
                records: requiredSyntaxRecords(req),
                frontendIdentity: req.syntaxFrontendIdentity,
                staticCacheHits: req.staticCacheHits,
                staticInstrumentation: staticTimings.instrumentation,
                providedRecordCacheSize: providedRecordCacheSizeFromEnv(),
                nativeFactProjection: req.nativeFactProjection,
              })
          await writePatchEvents(writeResponse, 'indexProjectAstFromSyntaxRecords', patch, {
            timings: staticTimings.summary(),
          })
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
    } finally {
      await cleanupProjectIndexWorkerRequest(req)
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

function requiredSyntaxRecords(
  req: ProjectIndexWorkerRequest,
): NonNullable<ProjectIndexWorkerRequest['syntaxRecords']> {
  if (!req.syntaxRecords) throw new Error('indexProjectAstFromSyntaxRecords requires syntaxRecords')
  return req.syntaxRecords
}

async function cleanupProjectIndexWorkerRequest(req: ProjectIndexWorkerRequest): Promise<void> {
  try {
    await req.cleanup?.()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[project-indexer] cleanup error: ${message}\n`)
  }
}

function requestResolutionMode(value: unknown): ProjectModelResolutionMode | undefined {
  return isProjectModelResolutionMode(value) ? value : undefined
}

rl.on('close', () => {
  closing = true
  maybeExit()
})
