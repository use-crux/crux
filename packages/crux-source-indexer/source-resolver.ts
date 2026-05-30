/**
 * Source map resolver for local Crux source intelligence workers.
 *
 * Discovers and parses source maps to resolve bundled file:line locations
 * back to original source, and to extract readable function bodies from
 * minified code.
 *
 * @module
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TraceMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping'

// ─── Public types ───

export interface ResolvedLocation {
  file: string
  line: number
  column?: number
  function?: string
  resolved: boolean
}

export interface ResolvedFnSource {
  /** The extracted original function body. */
  source: string
  /** Original file path (from source map). */
  file: string
  /** Start line in original file. */
  startLine: number
  resolved: boolean
}

// ─── SourceResolver ───

const MAX_LOCATION_CACHE = 5000
const MAX_FN_EXTRACT_LINES = 200

export class SourceResolver {
  /** Parsed TraceMap cache, keyed by normalized bundled file path. */
  private mapCache = new Map<string, TraceMap | null>()
  /** Resolved location cache, keyed by `file:line:column`. */
  private locationCache = new Map<string, ResolvedLocation>()
  /** Bundled file content cache. */
  private fileContentCache = new Map<string, string>()

  /**
   * Resolve a single bundled source location to its original position.
   */
  async resolveLocation(file: string, line: number, column?: number, fn?: string): Promise<ResolvedLocation> {
    const cacheKey = `${file}:${line}:${column ?? 0}`
    const cached = this.locationCache.get(cacheKey)
    if (cached) return cached

    const traceMap = await this.loadTraceMap(file)
    if (!traceMap) {
      const result: ResolvedLocation = {
        file,
        line,
        column,
        function: fn,
        resolved: false,
      }
      this.cacheLocation(cacheKey, result)
      return result
    }

    const pos = originalPositionFor(traceMap, { line, column: column ?? 0 })
    if (!pos.source) {
      const result: ResolvedLocation = {
        file,
        line,
        column,
        function: fn,
        resolved: false,
      }
      this.cacheLocation(cacheKey, result)
      return result
    }

    const result: ResolvedLocation = {
      file: pos.source,
      line: pos.line!,
      column: pos.column ?? undefined,
      function: pos.name ?? fn,
      resolved: true,
    }
    this.cacheLocation(cacheKey, result)
    return result
  }

  /**
   * Resolve a function's source code from a bundled file location.
   *
   * Uses the source map to find the original file + line, then extracts
   * the function body from the original source using `sourcesContent`.
   */
  async resolveFnSource(file: string, line: number, column?: number): Promise<ResolvedFnSource | null> {
    const traceMap = await this.loadTraceMap(file)
    if (!traceMap) return null

    const pos = originalPositionFor(traceMap, { line, column: column ?? 0 })
    if (!pos.source || !pos.line) return null

    // Get original source text from sourcesContent
    let content: string | null = null
    try {
      content = sourceContentFor(traceMap, pos.source)
    } catch {
      // sourcesContent not available
    }

    // Fallback: try reading original file from disk
    if (!content) {
      const originalPath = resolveOriginalPath(file, pos.source)
      if (originalPath && existsSync(originalPath)) {
        try {
          content = await readFile(originalPath, 'utf-8')
        } catch {
          // Can't read file
        }
      }
    }

    if (!content) return null

    const extracted = extractFunctionBody(content, pos.line, pos.column ?? 0)
    if (!extracted) return null

    return {
      source: extracted.source,
      file: pos.source,
      startLine: pos.line,
      resolved: true,
    }
  }

  /**
   * Resolve an array of stack frames in a single batch.
   */
  async resolveStack(
    frames: Array<{
      file: string
      line: number
      column?: number
      function?: string
    }>,
  ): Promise<ResolvedLocation[]> {
    return Promise.all(frames.map((f) => this.resolveLocation(f.file, f.line, f.column, f.function)))
  }

  // ─── Private helpers ───

  private async loadTraceMap(file: string): Promise<TraceMap | null> {
    const normalized = normalizePath(file)
    const cached = this.mapCache.get(normalized)
    if (cached !== undefined) return cached

    const mapJson = await discoverSourceMap(normalized)
    if (!mapJson) {
      this.mapCache.set(normalized, null)
      return null
    }

    try {
      const traceMap = new TraceMap(mapJson)
      this.mapCache.set(normalized, traceMap)
      return traceMap
    } catch {
      this.mapCache.set(normalized, null)
      return null
    }
  }

  private cacheLocation(key: string, value: ResolvedLocation): void {
    // Simple LRU: evict oldest entries when over capacity
    if (this.locationCache.size >= MAX_LOCATION_CACHE) {
      const firstKey = this.locationCache.keys().next().value
      if (firstKey !== undefined) this.locationCache.delete(firstKey)
    }
    this.locationCache.set(key, value)
  }
}

// ─── Source map discovery ───

/**
 * Discover and load source map JSON for a bundled file.
 * Tries sidecar `.map` file first, then `//# sourceMappingURL=` comment.
 */
async function discoverSourceMap(bundledFile: string): Promise<string | null> {
  // 1. Sidecar: file.js → file.js.map
  const sidecarPath = bundledFile + '.map'
  if (existsSync(sidecarPath)) {
    try {
      return await readFile(sidecarPath, 'utf-8')
    } catch {
      // Fall through
    }
  }

  // 2. Read the bundle's sourceMappingURL comment
  let bundleContent: string
  try {
    bundleContent = await readFile(bundledFile, 'utf-8')
  } catch {
    return null
  }

  // Look for //# sourceMappingURL= in the last portion of the file
  const tail = bundleContent.slice(-2000)
  const match = tail.match(/\/\/[#@]\s*sourceMappingURL=(.+)$/m)
  if (!match) return null

  const url = match[1]!.trim()

  // Data URI (inline source map)
  if (url.startsWith('data:')) {
    const base64Match = url.match(/;base64,(.+)/)
    if (!base64Match) return null
    try {
      return Buffer.from(base64Match[1]!, 'base64').toString('utf-8')
    } catch {
      return null
    }
  }

  // Relative path
  const mapPath = resolvePath(dirname(bundledFile), url)
  if (existsSync(mapPath)) {
    try {
      return await readFile(mapPath, 'utf-8')
    } catch {
      // Fall through
    }
  }

  return null
}

// ─── Path utilities ───

function normalizePath(filePath: string): string {
  if (filePath.startsWith('file://')) {
    try {
      return fileURLToPath(filePath)
    } catch {
      return filePath.replace(/^file:\/\//, '')
    }
  }
  return filePath
}

function resolveOriginalPath(bundledFile: string, sourcePath: string): string | null {
  if (!sourcePath) return null
  // Source paths in maps are often relative to the source map / bundle directory
  try {
    return resolvePath(dirname(bundledFile), sourcePath)
  } catch {
    return null
  }
}

// ─── Function body extraction ───

/**
 * Extract a function body from source text starting at a given line/column.
 *
 * Handles arrow functions (`=> { ... }` and `=> expr`),
 * regular functions (`function(...) { ... }`), and template literals.
 */
function extractFunctionBody(
  source: string,
  startLine: number,
  startColumn: number,
): { source: string; endLine: number } | null {
  const lines = source.split('\n')
  if (startLine < 1 || startLine > lines.length) return null

  // Find the function start — scan from the mapped position
  const lineIdx = startLine - 1
  const startText = lines[lineIdx]!

  // Collect text from start position onward
  const result: string[] = []
  let depth = 0
  let inString: string | null = null
  let inTemplate = false
  let templateDepth = 0
  let started = false

  for (let i = lineIdx; i < lines.length && i < lineIdx + MAX_FN_EXTRACT_LINES; i++) {
    const line = i === lineIdx ? lines[i]!.slice(Math.max(0, startColumn)) : lines[i]!
    result.push(i === lineIdx ? lines[i]! : lines[i]!)

    for (let j = i === lineIdx ? startColumn : 0; j < lines[i]!.length; j++) {
      const ch = lines[i]![j]!
      const prev = j > 0 ? lines[i]![j - 1] : ''

      // Handle string escapes
      if (prev === '\\') continue

      // Track strings
      if (inString) {
        if (ch === inString) inString = null
        continue
      }
      if (inTemplate) {
        if (ch === '`') {
          inTemplate = false
          continue
        }
        if (ch === '$' && j + 1 < lines[i]!.length && lines[i]![j + 1] === '{') {
          templateDepth++
          continue
        }
        if (ch === '}' && templateDepth > 0) {
          templateDepth--
          continue
        }
        continue
      }

      if (ch === '"' || ch === "'") {
        inString = ch
        continue
      }
      if (ch === '`') {
        inTemplate = true
        continue
      }

      // Track braces/parens
      if (ch === '{' || ch === '(') {
        depth++
        started = true
      }
      if (ch === '}' || ch === ')') {
        depth--
      }
    }

    // End when we've closed all open braces (after at least one opened)
    if (started && depth <= 0) {
      return { source: result.join('\n'), endLine: i + 1 }
    }
  }

  // If we never saw braces, it might be an expression arrow: `=> expr`
  // Return what we have (up to first empty line or dedent)
  if (!started && result.length > 0) {
    return { source: result.join('\n'), endLine: lineIdx + result.length }
  }

  // Exceeded max lines — return what we have
  if (result.length > 0) {
    return { source: result.join('\n'), endLine: lineIdx + result.length }
  }

  return null
}
