/**
 * Original source loading for function source extraction.
 *
 * Source text is loaded from `sourcesContent` first because that is the most
 * faithful source-map payload. Disk fallback is only used when source content
 * is absent and a source-map source can be resolved relative to the bundle.
 *
 * @module
 */

import { dirname, resolve as resolvePath } from 'node:path'
import { sourceContentFor, type TraceMap } from '@jridgewell/trace-mapping'
import type { SourceResolverFileSystem } from './filesystem'
import { isReadablePathInsideRoot } from './path-containment'

/** Original source text plus the resolver path that loaded it. */
export interface LoadedOriginalSource {
  /** Original source content. */
  readonly content: string
  /** Whether content came from `sourcesContent` or disk fallback. */
  readonly source: 'source-map' | 'disk'
}

/** Options for source-map original source disk fallback. */
export interface OriginalSourceLoadOptions {
  /** Project root that all disk fallback reads must stay inside. */
  readonly projectRoot?: string
}

/** Resolve an original source-map source path relative to a bundled file. */
export function resolveOriginalPath(bundledFile: string, sourcePath: string): string | null {
  if (!sourcePath) return null
  try {
    return resolvePath(dirname(bundledFile), sourcePath)
  } catch {
    return null
  }
}

/**
 * Load original source text for a resolved trace-map source.
 *
 * The function returns `null` for unavailable source instead of throwing,
 * preserving the resolver facade's best-effort behavior.
 */
export async function loadOriginalSource(
  traceMap: TraceMap,
  bundledFile: string,
  sourcePath: string,
  fileSystem: SourceResolverFileSystem,
  options: OriginalSourceLoadOptions = {},
): Promise<string | null> {
  const loaded = await loadOriginalSourceWithKind(traceMap, bundledFile, sourcePath, fileSystem, options)
  return loaded?.content ?? null
}

/**
 * Load original source text and report which resolver path supplied it.
 *
 * Frame snapshots need this provenance for the public `resolver` field while
 * the older function-source path still only needs the raw text.
 */
export async function loadOriginalSourceWithKind(
  traceMap: TraceMap,
  bundledFile: string,
  sourcePath: string,
  fileSystem: SourceResolverFileSystem,
  options: OriginalSourceLoadOptions = {},
): Promise<LoadedOriginalSource | null> {
  try {
    const sourceContent = sourceContentFor(traceMap, sourcePath)
    if (sourceContent) return { content: sourceContent, source: 'source-map' }
  } catch {
    // Fall through to disk fallback.
  }

  const originalPath = resolveOriginalPath(bundledFile, sourcePath)
  if (!originalPath || !fileSystem.exists(originalPath)) return null
  if (options.projectRoot && !(await isReadablePathInsideRoot(options.projectRoot, originalPath, fileSystem))) return null

  try {
    return { content: await fileSystem.readFile(originalPath), source: 'disk' }
  } catch {
    return null
  }
}
