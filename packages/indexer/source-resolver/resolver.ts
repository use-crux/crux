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
import type { TraceMap } from '@jridgewell/trace-mapping'
import { locationCacheKey, putLocationCache, type LocationCacheKey } from './cache'
import { discoverSourceMap, normalizePath } from './discovery'
import { extractFunctionBody } from './extraction'
import { nodeSourceResolverFileSystem, type SourceResolverFileSystem } from './filesystem'
import { loadOriginalSource, loadOriginalSourceWithKind } from './original-source'
import { parseTraceMap, resolveOriginalPosition } from './trace-map'
import type {
  ResolvedFnSource,
  ResolvedLocation,
  SourceFrameOptions,
  SourceFrameResolution,
  SourceLocation,
} from './types'

/** Options for constructing a `SourceResolver`. */
export interface SourceResolverOptions {
  /** Filesystem dependency used for source maps and original source fallback. */
  readonly fileSystem?: SourceResolverFileSystem
}

/** Resolve bundled trace locations and original function source through source maps. */
export class SourceResolver {
  private readonly fileSystem: SourceResolverFileSystem
  private mapCache = new Map<string, TraceMap | null>()
  private locationCache = new Map<LocationCacheKey, ResolvedLocation>()

  /** Create a source resolver with optional filesystem dependency injection. */
  constructor(options: SourceResolverOptions = {}) {
    this.fileSystem = options.fileSystem ?? nodeSourceResolverFileSystem
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
    if (!traceMap) return this.cacheAndReturn(key, unresolvedLocation(file, line, column, fn))

    const resolved = resolveOriginalPosition(traceMap, line, column)
    if (resolved.kind === 'unresolved') return this.cacheAndReturn(key, unresolvedLocation(file, line, column, fn))

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

    const content = await loadOriginalSource(traceMap, normalizePath(file), resolved.file, this.fileSystem)
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
   * Generated code is never returned as a fallback. Missing maps, missing
   * source content, or unmapped positions produce `kind: 'unavailable'`.
   */
  async resolveSourceFrame(
    file: string,
    line: number,
    column?: number,
    options: SourceFrameOptions = {},
  ): Promise<SourceFrameResolution> {
    const normalized = normalizePath(file)
    const traceMap = await this.loadTraceMap(normalized)
    if (!traceMap) return { kind: 'unavailable', reason: 'source-map-missing' }

    const resolved = resolveOriginalPosition(traceMap, line, column)
    if (resolved.kind === 'unresolved') return { kind: 'unavailable', reason: 'source-file-missing' }

    const loaded = await loadOriginalSourceWithKind(traceMap, normalized, resolved.file, this.fileSystem)
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
    const cached = this.mapCache.get(normalized)
    if (cached !== undefined) return cached

    const discovered = await discoverSourceMap(normalized, this.fileSystem)
    if (discovered.kind === 'not-found') {
      this.mapCache.set(normalized, null)
      return null
    }

    const traceMap = parseTraceMap(discovered.mapJson)
    this.mapCache.set(normalized, traceMap)
    return traceMap
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
