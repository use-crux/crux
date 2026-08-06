import { createRuntimeError } from '@use-crux/core/runtime'

export function noop(): void {}

export function requireNamespace(namespace: string | undefined, operation: string): string {
  if (namespace) return namespace
  throw createRuntimeError({
    code: 'NAMESPACE_AMBIGUOUS',
    whatFailed: `Convex Runtime Engine ${operation} was called without a namespace.`,
    why: 'The Convex component cannot safely satisfy namespace-less runtime scans without reading unbounded runtime tables.',
    whatStillWorks:
      'Runtime handlers and maintenance created from convex({ namespace }) continue to pass their configured namespace.',
    nextStep: 'Pass an explicit runtime namespace or use a Convex Runtime Engine definition configured with namespace.',
  })
}

export function cleanArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))
}
