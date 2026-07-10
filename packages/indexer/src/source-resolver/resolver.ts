/**
 * Source resolver facade and orchestration.
 *
 * `SourceResolver` is the stable runtime entry point used by the devtools
 * worker. It intentionally holds cache state, while delegating parsing,
 * discovery, source loading, and extraction to documented functional modules.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { TraceMap } from '@jridgewell/trace-mapping'
import { locationCacheKey, putLocationCache, type LocationCacheKey } from './cache'
import { discoverSourceMap, normalizePath } from './discovery'
import { extractFunctionBody } from './extraction'
import { nodeSourceResolverFileSystem, type SourceResolverFileSystem } from './filesystem'
import { loadOriginalSource, loadOriginalSourceWithKind, resolveOriginalPath } from './original-source'
import { isReadablePathInsideRoot } from './path-containment'
import { parseTraceMap, resolveOriginalPosition } from './trace-map'
import type {
  ResolvedFnSource,
  ResolvedLocation,
  SourceFrameOptions,
  SourceFrameResolution,
  SourceLocation,
} from './types'

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

/** Options for constructing a `SourceResolver`. */
export interface SourceResolverOptions {
  /** Filesystem dependency used for source maps and original source fallback. */
  readonly fileSystem?: SourceResolverFileSystem
  /** Project root that untrusted source-map file reads must stay inside. */
  readonly projectRoot?: string
}

/** Resolve bundled trace locations and original function source through source maps. */
export class SourceResolver {
  private readonly fileSystem: SourceResolverFileSystem
  private readonly projectRoot: string | undefined
  private mapCache = new Map<string, TraceMap>()
  private locationCache = new Map<LocationCacheKey, ResolvedLocation>()

  /** Create a source resolver with optional filesystem dependency injection. */
  constructor(options: SourceResolverOptions = {}) {
    this.fileSystem = options.fileSystem ?? nodeSourceResolverFileSystem
    this.projectRoot = options.projectRoot
  }

  /**
   * Resolve a single bundled source location to its original position.
   *
   * Unresolved lookups return the original bundled location with
   * `resolved: false` instead of throwing.
   */
  async resolveLocation(file: string, line: number, column?: number, fn?: string): Promise<ResolvedLocation> {
    const key = locationCacheKey(file, line, column)
    const cached = this.locationCache.get(key)
    if (cached) return cached

    const traceMap = await this.loadTraceMap(file)
    if (!traceMap) return unresolvedLocation(file, line, column, fn)

    const resolved = resolveOriginalPosition(traceMap, line, column)
    if (resolved.kind === 'unresolved') return unresolvedLocation(file, line, column, fn)

    return this.cacheAndReturn(key, {
      file: resolved.file,
      line: resolved.line,
      column: resolved.column,
      function: resolved.name ?? fn,
      resolved: true,
    })
  }

  /**
   * Resolve and extract a function's original source code.
   *
   * Source text is loaded from `sourcesContent` first and falls back to disk.
   * Missing maps, missing source text, or extraction misses return `null`.
   */
  async resolveFnSource(file: string, line: number, column?: number): Promise<ResolvedFnSource | null> {
    const traceMap = await this.loadTraceMap(file)
    if (!traceMap) return null

    const resolved = resolveOriginalPosition(traceMap, line, column)
    if (resolved.kind === 'unresolved') return null

    const content = await loadOriginalSource(
      traceMap,
      normalizePath(file),
      resolved.file,
      this.fileSystem,
      this.containmentOptions(),
    )
    if (!content) return null

    const extracted = extractFunctionBody(content, resolved.line, resolved.column ?? 0)
    if (!extracted) return null

    return {
      source: extracted.source,
      file: resolved.file,
      startLine: resolved.line,
      resolved: true,
    }
  }

  /**
   * Resolve a generated location into a narrow authored source-frame snapshot.
   *
   * Generated code is never returned as a fallback. When the captured location
   * already points at an authored source file, the resolver can snapshot that
   * file directly from disk; otherwise missing maps, missing source content, or
   * unmapped positions produce `kind: 'unavailable'`.
   */
  async resolveSourceFrame(
    file: string,
    line: number,
    column?: number,
    options: SourceFrameOptions = {},
  ): Promise<SourceFrameResolution> {
    const normalized = normalizePath(file)
    if (!(await this.canReadPath(normalized))) return { kind: 'unavailable', reason: 'source-outside-project' }

    const traceMap = await this.loadTraceMap(normalized)
    if (!traceMap) {
      const directFrame = await this.resolveDirectSourceFrame(normalized, line, column, options)
      return directFrame ?? { kind: 'unavailable', reason: 'source-map-missing' }
    }

    const resolved = resolveOriginalPosition(traceMap, line, column)
    if (resolved.kind === 'unresolved') return { kind: 'unavailable', reason: 'source-file-missing' }
    if (!(await this.canReadOriginalSourcePath(normalized, resolved.file))) {
      return { kind: 'unavailable', reason: 'source-outside-project' }
    }

    const loaded = await loadOriginalSourceWithKind(
      traceMap,
      normalized,
      resolved.file,
      this.fileSystem,
      this.containmentOptions(),
    )
    if (!loaded) return { kind: 'unavailable', reason: 'source-file-missing' }

    const sourceLines = splitSourceLines(loaded.content)
    const authoredLine = resolved.line
    if (authoredLine < 1 || authoredLine > sourceLines.length) {
      return { kind: 'unavailable', reason: 'source-file-missing' }
    }

    const radius = options.frameRadius ?? 4
    const frameStartLine = Math.max(1, authoredLine - radius)
    const frameEndLine = Math.min(sourceLines.length, authoredLine + radius)
    const role = options.role ?? 'failed'
    const lines = sourceLines.slice(frameStartLine - 1, frameEndLine).map((text, index) => {
      const sourceLine = frameStartLine + index
      return {
        line: sourceLine,
        text,
        role: sourceLine === authoredLine ? role : 'context',
      }
    })
    const frameText = lines.map((frameLine) => frameLine.text).join('\n')

    return {
      kind: 'source-frame',
      sourceRef: options.sourceRef ?? `${file}:${line}:${column ?? 0}`,
      authoredFile: resolved.file,
      authoredLine,
      ...(resolved.column !== undefined ? { authoredColumn: resolved.column } : {}),
      frameStartLine,
      frameEndLine,
      lines,
      contentHash: `sha256:${sha256(frameText)}`,
      capturedAt: options.capturedAt ?? new Date().toISOString(),
      stale: false,
      resolver: loaded.source,
    }
  }

  /** Resolve an array of bundled stack frames in parallel. */
  async resolveStack(frames: readonly SourceLocation[]): Promise<ResolvedLocation[]> {
    return Promise.all(frames.map((f) => this.resolveLocation(f.file, f.line, f.column, f.function)))
  }

  private cacheAndReturn(key: LocationCacheKey, value: ResolvedLocation): ResolvedLocation {
    this.locationCache = putLocationCache(this.locationCache, key, value)
    return value
  }

  private async loadTraceMap(file: string): Promise<TraceMap | null> {
    const normalized = normalizePath(file)
    if (!(await this.canReadPath(normalized))) return null
    const cached = this.mapCache.get(normalized)
    if (cached !== undefined) return cached

    const discovered = await discoverSourceMap(normalized, this.fileSystem, this.containmentOptions())
    if (discovered.kind === 'not-found') return null

    const traceMap = parseTraceMap(discovered.mapJson)
    if (!traceMap) return null
    this.mapCache.set(normalized, traceMap)
    return traceMap
  }

  /**
   * Resolve frames for stack refs that are already authored source locations.
   *
   * Assertion stacks from TypeScript runtimes such as `tsx` often arrive as
   * `.eval.ts` source refs. They do not need source-map lookup, but generated
   * output files without maps still degrade instead of leaking compiled code.
   */
  private async resolveDirectSourceFrame(
    file: string,
    line: number,
    column: number | undefined,
    options: SourceFrameOptions,
  ): Promise<SourceFrameResolution | null> {
    if (!(await this.canReadPath(file))) return { kind: 'unavailable', reason: 'source-outside-project' }
    if (!isDirectAuthoredSourceCandidate(file) || !this.fileSystem.exists(file)) return null

    let content: string
    try {
      content = await this.fileSystem.readFile(file)
    } catch {
      return { kind: 'unavailable', reason: 'source-file-missing' }
    }

    const sourceLines = splitSourceLines(content)
    if (line < 1 || line > sourceLines.length) {
      return { kind: 'unavailable', reason: 'source-file-missing' }
    }

    const radius = options.frameRadius ?? 4
    const frameStartLine = Math.max(1, line - radius)
    const frameEndLine = Math.min(sourceLines.length, line + radius)
    const role = options.role ?? 'failed'
    const lines = sourceLines.slice(frameStartLine - 1, frameEndLine).map((text, index) => {
      const sourceLine = frameStartLine + index
      return {
        line: sourceLine,
        text,
        role: sourceLine === line ? role : 'context',
      }
    })
    const frameText = lines.map((frameLine) => frameLine.text).join('\n')

    return {
      kind: 'source-frame',
      sourceRef: options.sourceRef ?? `${file}:${line}:${column ?? 0}`,
      authoredFile: file,
      authoredLine: line,
      ...(column !== undefined ? { authoredColumn: column } : {}),
      frameStartLine,
      frameEndLine,
      lines,
      contentHash: `sha256:${sha256(frameText)}`,
      capturedAt: options.capturedAt ?? new Date().toISOString(),
      stale: false,
      resolver: 'disk',
    }
  }

  private async canReadOriginalSourcePath(bundledFile: string, sourcePath: string): Promise<boolean> {
    if (!this.projectRoot) return true
    const originalPath = resolveOriginalPath(bundledFile, sourcePath)
    if (!originalPath) return false
    return isReadablePathInsideRoot(this.projectRoot, originalPath, this.fileSystem)
  }

  private async canReadPath(file: string): Promise<boolean> {
    return !this.projectRoot || isReadablePathInsideRoot(this.projectRoot, file, this.fileSystem)
  }

  private containmentOptions(): { readonly projectRoot?: string } {
    return this.projectRoot ? { projectRoot: this.projectRoot } : {}
  }
}

function unresolvedLocation(file: string, line: number, column?: number, fn?: string): ResolvedLocation {
  return { file, line, column, function: fn, resolved: false }
}

function splitSourceLines(source: string): string[] {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isDirectAuthoredSourceCandidate(file: string): boolean {
  const extension = extname(file)
  if (!DIRECT_SOURCE_FRAME_EXTENSIONS.has(extension)) return false

  const segments = file.split(/[\\/]+/).filter(Boolean)
  return !segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment))
}
