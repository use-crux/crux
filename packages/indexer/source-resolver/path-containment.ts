/**
 * Path containment helpers for source-map reads.
 *
 * Source-map paths come from project-authored files and must be treated as
 * untrusted input. Callers canonicalize candidates, verify lexical containment,
 * and, when the filesystem can provide it, verify realpath containment before
 * reading.
 *
 * @module
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type { SourceResolverFileSystem } from './filesystem'

/** Return whether `candidate` is inside `root` after absolute path normalization. */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

/**
 * Return whether a path is safe to read for a project-root-scoped resolver.
 *
 * Filesystems that expose `realpath` get an additional symlink-escape check.
 * Test filesystems may omit it, in which case lexical containment is still
 * enforced.
 */
export async function isReadablePathInsideRoot(
  root: string,
  candidate: string,
  fileSystem: SourceResolverFileSystem,
): Promise<boolean> {
  if (!isPathInsideRoot(root, candidate)) return false
  if (!fileSystem.realpath) return true
  try {
    const [realRoot, realCandidate] = await Promise.all([fileSystem.realpath(root), fileSystem.realpath(candidate)])
    return isPathInsideRoot(realRoot, realCandidate)
  } catch {
    return false
  }
}
