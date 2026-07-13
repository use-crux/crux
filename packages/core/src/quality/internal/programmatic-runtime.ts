/**
 * Programmatic Quality runtime defaults.
 *
 * `evaluation.run()` is intentionally tiny for Vitest-style usage, but its
 * records still need the same evidence quality as `crux quality run` when a
 * local devtools server is available. This module supplies the Node-local
 * pieces that do not require the first-party CLI worker: direct disk source
 * frames and best-effort devtools trace forwarding.
 *
 * @internal
 * @module
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import {
  createHttpObservabilityTransport,
  currentObservabilityTransport,
  observe,
  setObservabilityTransport,
} from '../../observability'
import type { QualitySourceFrame, QualitySourceFrameResolver } from '../source-frame'

const DIRECT_SOURCE_FRAME_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const GENERATED_PATH_SEGMENTS = new Set([
  '.next',
  '.nuxt',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
])

let localDevtoolsProbe: Promise<string | undefined> | undefined

/**
 * Build a direct-disk source-frame resolver for programmatic `.run()` calls.
 *
 * The resolver only snapshots authored-looking local source files under the
 * run root. Bundled/generated files still degrade honestly because source-map
 * lookup belongs to first-party tooling such as the CLI/indexer worker.
 */
export function createProgrammaticSourceFrameResolver(rootDir: string): QualitySourceFrameResolver {
  const root = resolve(rootDir)
  return {
    async resolveSourceFrame(request): Promise<QualitySourceFrame> {
      const file = isAbsolute(request.file) ? request.file : resolve(root, request.file)
      if (!isWithinRoot(root, file)) {
        return { kind: 'unavailable', reason: 'source-outside-project' }
      }
      if (!isDirectAuthoredSourceCandidate(file)) {
        return { kind: 'unavailable', reason: 'source-map-missing' }
      }

      let content: string
      try {
        content = await readFile(file, 'utf8')
      } catch {
        return { kind: 'unavailable', reason: 'source-file-missing' }
      }

      const lines = splitSourceLines(content)
      if (request.line < 1 || request.line > lines.length) {
        return { kind: 'unavailable', reason: 'source-file-missing' }
      }

      const frameStartLine = Math.max(1, request.line - request.frameRadius)
      const frameEndLine = Math.min(lines.length, request.line + request.frameRadius)
      const frameLines = lines.slice(frameStartLine - 1, frameEndLine).map((text, index) => {
        const line = frameStartLine + index
        return {
          line,
          text,
          role: line === request.line ? request.role : 'context',
        }
      })
      const frameText = frameLines.map((line) => line.text).join('\n')

      return {
        kind: 'source-frame',
        sourceRef: request.sourceRef,
        authoredFile: file,
        authoredLine: request.line,
        ...(request.column !== undefined ? { authoredColumn: request.column } : {}),
        frameStartLine,
        frameEndLine,
        lines: frameLines,
        contentHash: `sha256:${sha256(frameText)}`,
        capturedAt: request.capturedAt,
        stale: false,
        resolver: 'disk',
      }
    },
  }
}

/**
 * Ensure direct `.run()` calls have a devtools transport when one is obvious.
 *
 * Existing project transports win. Otherwise the runner uses `CRUX_DEVTOOLS_URL`
 * or `DEVTOOLS_URL`, falling back to one cached quick probe of localhost:4400
 * outside CI. This keeps local Vitest-generated experiments connected to trace
 * detail without making CI depend on a devtools server.
 */
export async function ensureProgrammaticObservability(): Promise<boolean> {
  if (currentObservabilityTransport() !== undefined) return true
  const serverUrl = await resolveProgrammaticDevtoolsUrl()
  if (serverUrl === undefined) return false

  setObservabilityTransport(createHttpObservabilityTransport({ serverUrl, timeoutMs: 1_000 }), {
    maxPendingDeliveries: 1,
    retryDelayMs: 100,
    maxRetryDelayMs: 100,
  })
  return true
}

/** Flush trace delivery after a direct programmatic run has finished. */
export async function flushProgrammaticObservability(enabled: boolean): Promise<void> {
  if (!enabled || currentObservabilityTransport() === undefined) return
  await observe.flush({ timeoutMs: 1_000 })
}

async function resolveProgrammaticDevtoolsUrl(): Promise<string | undefined> {
  const explicit = env('CRUX_DEVTOOLS_URL') ?? env('DEVTOOLS_URL')
  if (explicit !== undefined && explicit.trim() !== '') return explicit
  if (env('CRUX_QUALITY_AUTO_DEVTOOLS') === '0' || env('CI') === 'true') return undefined
  localDevtoolsProbe ??= probeLocalDevtools()
  return await localDevtoolsProbe
}

async function probeLocalDevtools(): Promise<string | undefined> {
  const fetchImpl = globalThis.fetch
  if (fetchImpl === undefined) return undefined

  const serverUrl = 'http://localhost:4400'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 150)
  try {
    const response = await fetchImpl(`${serverUrl}/api/stats`, {
      method: 'GET',
      signal: controller.signal,
    })
    return response.ok ? serverUrl : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

function env(name: string): string | undefined {
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return processLike?.env?.[name]
}

function isWithinRoot(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isDirectAuthoredSourceCandidate(file: string): boolean {
  if (!DIRECT_SOURCE_FRAME_EXTENSIONS.has(extname(file))) return false
  const segments = file.split(/[\\/]+/u).filter(Boolean)
  return !segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment))
}

function splitSourceLines(source: string): string[] {
  return source.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
