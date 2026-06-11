/**
 * Filesystem dependency boundary for source resolver pure functions.
 *
 * The resolver core accepts this small interface instead of importing Node's
 * filesystem APIs directly. Tests can provide deterministic in-memory effects,
 * while the `SourceResolver` facade uses `nodeSourceResolverFileSystem`.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/** Minimal filesystem capabilities required by source-map resolution. */
export interface SourceResolverFileSystem {
  /** Return true when a path exists and can be considered for reading. */
  readonly exists: (path: string) => boolean
  /** Read a UTF-8 text file. Errors are handled by caller-owned fallback policy. */
  readonly readFile: (path: string) => Promise<string>
}

/** Node-backed filesystem implementation used by the runtime resolver facade. */
export const nodeSourceResolverFileSystem: SourceResolverFileSystem = {
  exists: existsSync,
  readFile: (path) => readFile(path, 'utf-8'),
}
