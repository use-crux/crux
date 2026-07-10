/**
 * Source-map discovery for bundled runtime files.
 *
 * Discovery is pure with respect to process state: filesystem access is
 * provided by a dependency object, and failures are returned as typed miss
 * results instead of being logged or thrown.
 *
 * @module
 */

import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SourceResolverFileSystem } from './filesystem'
import { isReadablePathInsideRoot } from './path-containment'
import type { SourceMapDiscoveryResult } from './types'

/** Convert file URLs to filesystem paths while preserving non-URL inputs. */
export function normalizePath(filePath: string): string {
  if (!filePath.startsWith('file://')) return filePath
  try {
    return fileURLToPath(filePath)
  } catch {
    return filePath.replace(/^file:\/\//, '')
  }
}

/** Options for source-map discovery from untrusted project paths. */
export interface SourceMapDiscoveryOptions {
  /** Project root that sidecar, bundle, and relative map reads must stay inside. */
  readonly projectRoot?: string
}

/**
 * Discover and read a source map for a bundled file.
 *
 * Fallback order is sidecar `<bundle>.map`, then a trailing
 * `sourceMappingURL` comment. Relative URLs are resolved from the bundled
 * file directory. Inline base64 data URIs are decoded in memory.
 */
export async function discoverSourceMap(
  bundledFile: string,
  fileSystem: SourceResolverFileSystem,
  options: SourceMapDiscoveryOptions = {},
): Promise<SourceMapDiscoveryResult> {
  const sidecarPath = `${bundledFile}.map`
  if (
    fileSystem.exists(sidecarPath) &&
    (!options.projectRoot || (await isReadablePathInsideRoot(options.projectRoot, sidecarPath, fileSystem)))
  ) {
    try {
      return { kind: 'found', mapJson: await fileSystem.readFile(sidecarPath), source: 'sidecar' }
    } catch {
      return { kind: 'not-found', reason: 'relative-map-not-readable' }
    }
  }

  let bundleContent: string
  try {
    if (options.projectRoot && !(await isReadablePathInsideRoot(options.projectRoot, bundledFile, fileSystem))) {
      return { kind: 'not-found', reason: 'bundle-not-readable' }
    }
    bundleContent = await fileSystem.readFile(bundledFile)
  } catch {
    return { kind: 'not-found', reason: 'bundle-not-readable' }
  }

  const tail = bundleContent.slice(-2000)
  const match = tail.match(/\/\/[#@]\s*sourceMappingURL=(.+)$/m)
  if (!match) return { kind: 'not-found', reason: 'mapping-url-missing' }

  const url = match[1]?.trim() ?? ''
  if (url.startsWith('data:')) {
    const base64Match = url.match(/;base64,(.+)/)
    if (!base64Match) return { kind: 'not-found', reason: 'inline-map-invalid' }
    try {
      return {
        kind: 'found',
        mapJson: Buffer.from(base64Match[1] ?? '', 'base64').toString('utf-8'),
        source: 'inline',
      }
    } catch {
      return { kind: 'not-found', reason: 'inline-map-invalid' }
    }
  }

  const mapPath = resolvePath(dirname(bundledFile), url)
  if (!fileSystem.exists(mapPath)) return { kind: 'not-found', reason: 'relative-map-not-readable' }
  if (options.projectRoot && !(await isReadablePathInsideRoot(options.projectRoot, mapPath, fileSystem))) {
    return { kind: 'not-found', reason: 'relative-map-not-readable' }
  }

  try {
    return { kind: 'found', mapJson: await fileSystem.readFile(mapPath), source: 'relative-url' }
  } catch {
    return { kind: 'not-found', reason: 'relative-map-not-readable' }
  }
}
