import { relative } from 'node:path'

/**
 * Builds the project-relative fallback name used when authored code does not provide a stable id.
 *
 * The result is intentionally rooted in the source path rather than the absolute project root so
 * anonymous definitions keep stable ids across machines. Pass only the authored variable name or
 * call-site token; this helper owns the path prefix and must be the only place that adds it.
 */
export function staticFallbackLocalName(root: string, file: string, name: string): string {
  return `${relative(root, file).replace(/\\/g, '/')}:${name}`
}

/**
 * Builds the authored-name surrogate for a standalone matched call expression.
 *
 * Record and TypeScript parser lanes both feed this token into {@link staticFallbackLocalName}. That
 * keeps `ctx.source.variableName` human-readable while `ctx.source.localName` carries the path.
 */
export function staticCallsiteVariableName(callName: string, line: number): string {
  return `${callName}-${line}`
}
