/**
 * Workspace path and mount normalization.
 *
 * Paths are validated against traversal, encoded separators, URLs, and drive
 * paths before becoming a branded {@link WorkspacePath}. Mounts are normalized,
 * de-duplicated, and resolved per read/write access.
 *
 * @module
 */

import type { NormalizedMount, WorkspaceMount, WorkspacePath } from './types'

/** The default `/workspace` + `/outputs` mounts. */
export function defaultMounts(): readonly WorkspaceMount[] {
  return [
    { path: '/workspace', access: 'readwrite', description: 'Scratch notes, intermediate files, and working state.' },
    { path: '/outputs', access: 'readwrite', description: 'Generated deliverables and files for the app/user.' },
  ]
}

/** Validate, normalize, de-duplicate, and sort mounts. */
export function normalizeMounts(mounts: readonly WorkspaceMount[]): readonly NormalizedMount[] {
  if (mounts.length === 0) throw new Error('workspace(): at least one mount is required.')
  const seen = new Set<string>()
  const normalized = mounts.map((mount) => {
    const path = normalizePath(mount.path)
    if (path === '/') throw new Error('workspace(): root mount "/" is not supported.')
    if (seen.has(path)) throw new Error(`workspace(): duplicate mount path "${path}".`)
    seen.add(path)
    return Object.freeze({ ...mount, path })
  })
  return Object.freeze(normalized.sort((a, b) => a.path.localeCompare(b.path)))
}

/** Validate and normalize a raw path into a branded {@link WorkspacePath}. */
export function normalizePath(input: string): WorkspacePath {
  if (!input) throw new Error('workspace path must be non-empty.')
  if (!input.startsWith('/')) throw new Error(`workspace path "${input}" must start with "/".`)
  if (input.includes('\0')) throw new Error('workspace path contains a null byte.')
  if (input.includes('\\')) throw new Error('workspace path must use forward slashes, not backslashes.')
  if (/^[a-zA-Z]:/.test(input) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    throw new Error(`workspace path "${input}" must be a workspace path, not a URL or drive path.`)
  }

  const parts = input.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    const decoded = safeDecode(part)
    if (part === '..' || decoded === '..') {
      throw new Error(`workspace path "${input}" contains path traversal.`)
    }
    if (decoded.includes('/') || decoded.includes('\\')) {
      throw new Error(`workspace path "${input}" contains encoded path separators.`)
    }
    normalized.push(part)
  }
  return (`/${normalized.join('/')}` || '/') as WorkspacePath
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Resolve the deepest mount covering `path`, enforcing read/write access. */
export function mountForPath(
  path: WorkspacePath,
  mounts: readonly NormalizedMount[],
  mode: 'read' | 'write',
): NormalizedMount {
  const match = mounts
    .filter((mount) => path === mount.path || path.startsWith(`${mount.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!match) {
    throw new Error(`workspace path "${path}" is outside configured workspace mounts.`)
  }
  if (mode === 'write' && match.access !== 'readwrite') {
    throw new Error(`workspace mount "${match.path}" is read-only.`)
  }
  return match
}
