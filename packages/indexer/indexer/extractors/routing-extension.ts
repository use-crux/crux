import { type IndexExtractor } from '../extensions'
import { internalStaticCallContext } from '../extensions/internal-native'
import { routingFactsFromStaticContext } from './routing'
import { routingFactsFromRecordContext } from './routing-record'

/**
 * Extracts routing primitives through the extension boundary.
 *
 * Routing still relies on parser-owned static call context because route/cascade/fallback structure is
 * traversal-heavy, but the extractor returns `ExtractedFacts` directly and no longer uses the removed
 * primitive extractor result shape.
 */
export const routingIndexExtractor: IndexExtractor = {
  name: 'routing',
  patterns: [
    { kind: 'call', name: 'router' },
    { kind: 'call', name: 'cascade' },
    { kind: 'call', name: 'fallback' },
  ],
  extract: (ctx) => {
    const staticCtx = internalStaticCallContext(ctx)
    if (!staticCtx) return routingFactsFromRecordContext(ctx)
    const extracted = routingFactsFromStaticContext(staticCtx)
    return extracted ? { kind: 'facts', facts: extracted } : { kind: 'none' }
  },
}
