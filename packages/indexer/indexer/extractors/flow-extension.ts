import { type IndexExtractor } from '../extensions'
import { internalStaticCallContext } from '../extensions/internal-native'
import { flowFactsFromStaticContext } from './flow'
import { flowFactsFromStaticRecordContext } from './flow-record'

/**
 * Extracts `flow(...)` definitions through the extension boundary.
 *
 * Flow structure still uses parser-owned static call context for ordered step/control extraction, but
 * this adapter returns immutable facts directly so the compiler path remains fact-first.
 */
export const flowIndexExtractor: IndexExtractor = {
  name: 'flow',
  patterns: [
    { kind: 'call', name: 'flow' },
    { kind: 'call', name: 'cruxFlow' },
  ],
  extract: (ctx) => {
    const recordExtracted = flowFactsFromStaticRecordContext(ctx)
    if (recordExtracted) return { kind: 'facts', facts: recordExtracted }
    const staticCtx = internalStaticCallContext(ctx)
    if (!staticCtx) return { kind: 'none' }
    const extracted = flowFactsFromStaticContext(staticCtx)
    return extracted ? { kind: 'facts', facts: extracted } : { kind: 'none' }
  },
}
