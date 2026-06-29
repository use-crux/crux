/**
 * Minimal glob matching for workspace list queries.
 *
 * Supports `*` (matches within a path segment) and `**` (matches across
 * segments). All other characters are matched literally.
 *
 * @module
 */

/** Whether a path contains a glob wildcard. */
export function hasGlob(path: string): boolean {
  return path.includes('*')
}

/** Compile a workspace glob pattern into an anchored {@link RegExp}. */
export function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      i += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += escapeRegExp(char)
    }
  }
  source += '$'
  return new RegExp(source)
}

function escapeRegExp(value: string | undefined): string {
  return (value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
