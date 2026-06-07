import { type CatalogExtractor } from '../extensions'
import type { StaticCallContext } from './types'
import { flowFactsFromStaticContext } from './flow'

/**
 * Extracts `flow(...)` definitions through the extension boundary.
 *
 * Flow structure still uses parser-owned static call context for ordered step/control extraction, but
 * this adapter returns immutable facts directly so the compiler path remains fact-first.
 */
export const flowCatalogExtractor: CatalogExtractor = {
  name: 'flow',
  patterns: [
    { kind: 'call', name: 'flow' },
    { kind: 'call', name: 'cruxFlow' },
  ],
  extract: (ctx) => {
    const staticCtx = ctx.unstableNative?.staticContext
    if (!isStaticCallContext(staticCtx)) return { kind: 'none' }
    const extracted = flowFactsFromStaticContext(staticCtx)
    return extracted ? { kind: 'facts', facts: extracted } : { kind: 'none' }
  },
}

/** Narrows the unstable native payload to the static call context required by flow extraction. */
function isStaticCallContext(value: unknown): value is StaticCallContext {
  return Boolean(value && typeof value === 'object' && 'callName' in value && 'variableName' in value)
}
