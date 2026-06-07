import { type CatalogExtractor } from '../extensions'
import type { StaticCallContext } from './types'
import { routingFactsFromStaticContext } from './routing'

/**
 * Extracts routing primitives through the extension boundary.
 *
 * Routing still relies on parser-owned static call context because route/cascade/fallback structure is
 * traversal-heavy, but the extractor returns `ExtractedFacts` directly and no longer uses the removed
 * primitive extractor result shape.
 */
export const routingCatalogExtractor: CatalogExtractor = {
  name: 'routing',
  patterns: [
    { kind: 'call', name: 'router' },
    { kind: 'call', name: 'cascade' },
    { kind: 'call', name: 'fallback' },
  ],
  extract: (ctx) => {
    const staticCtx = ctx.unstableNative?.staticContext
    if (!isStaticCallContext(staticCtx)) return { kind: 'none' }
    const extracted = routingFactsFromStaticContext(staticCtx)
    return extracted ? { kind: 'facts', facts: extracted } : { kind: 'none' }
  },
}

/** Narrows the unstable native payload to the static call context required by routing extraction. */
function isStaticCallContext(value: unknown): value is StaticCallContext {
  return Boolean(value && typeof value === 'object' && 'callName' in value && 'variableName' in value)
}
