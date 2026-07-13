/**
 * Repo-relative source sanitization for runtime definition evidence.
 *
 * A runtime emitter may hold a compiled/authored source location that is an
 * absolute host path. This module converts such a location into a
 * {@link SanitizedSourceRef} that is provably repo-relative, or omits it
 * entirely — it never emits an absolute host path or a `..` traversal onto the
 * wire. Built-in emitters generally omit source and let read-time Project Index
 * resolution supply the current location; this sanitizer is the guarantee for
 * the rare site that does hold a genuine compiled source plus a project root.
 *
 * @module
 */

import type { SanitizedSourceRef } from './contract'

/**
 * Source shape available on compiled definitions and runtime call sites. Mirrors
 * {@link import('./contract').CruxSourceLocation} but tolerates the partial/absent
 * values a runtime emitter may hold, so callers can hand over whatever they have.
 */
export interface DefinitionSourceInput {
  file?: string
  line?: number
  column?: number
  /** Present on stack-derived call sites; intentionally never emitted. */
  function?: string
}

/** Options controlling how a source location is proven repo-relative. */
export interface SanitizeDefinitionSourceOptions {
  /** Absolute project root used to relativize absolute source paths. */
  projectRoot?: string
}

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function isAbsolute(path: string): boolean {
  // POSIX root, Windows drive (C:/), or UNC (//server) — all after separator
  // normalization to forward slashes.
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function hasTraversal(path: string): boolean {
  return path.split('/').some((segment) => segment === '..')
}

/**
 * Convert a compiled/runtime source location into a repo-relative
 * {@link SanitizedSourceRef}, or `undefined` when a safe repo-relative form
 * cannot be proven. Never emits an absolute host path or a `..` traversal.
 */
export function sanitizeDefinitionSource(
  source: DefinitionSourceInput | undefined,
  options?: SanitizeDefinitionSourceOptions,
): SanitizedSourceRef | undefined {
  if (!source || typeof source.file !== 'string' || source.file.length === 0) {
    return undefined
  }
  if (!Number.isInteger(source.line) || (source.line as number) <= 0) {
    return undefined
  }

  let file = normalizeSeparators(source.file)

  if (isAbsolute(file)) {
    const root = options?.projectRoot
      ? normalizeSeparators(options.projectRoot).replace(/\/+$/, '')
      : undefined
    if (!root || !isAbsolute(root)) return undefined
    if (file === root) return undefined
    if (!file.startsWith(`${root}/`)) return undefined
    file = file.slice(root.length + 1)
  }

  // Strip a leading `./`, then reject anything that still walks upward. This
  // covers both plain relative `../x` inputs and absolute paths whose root-
  // relative remainder escaped via `..`.
  file = file.replace(/^\.\//, '')
  if (file.length === 0 || isAbsolute(file) || hasTraversal(file)) return undefined

  const column =
    Number.isInteger(source.column) && (source.column as number) > 0
      ? (source.column as number)
      : undefined

  return column === undefined
    ? { file, line: source.line as number }
    : { file, line: source.line as number, column }
}
