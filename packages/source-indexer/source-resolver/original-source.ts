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
): Promise<string | null> {
  try {
    const sourceContent = sourceContentFor(traceMap, sourcePath)
    if (sourceContent) return sourceContent
  } catch {
    // Fall through to disk fallback.
  }

  const originalPath = resolveOriginalPath(bundledFile, sourcePath)
  if (!originalPath || !fileSystem.exists(originalPath)) return null

  try {
    return await fileSystem.readFile(originalPath)
  } catch {
    return null
  }
}
