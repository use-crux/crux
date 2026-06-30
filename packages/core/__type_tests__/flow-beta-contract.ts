/**
 * Type-level contract for the Flows beta public API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract.
 */

import { expectTypeOf } from 'vitest'
import { flow } from '../flow'

const review = flow('review', async (scope, input: { docId: string; priority?: 'low' | 'high' }) => {
  const loaded = await scope.step('load', () => ({ docId: input.docId }))
  return { published: input.priority === 'high', docId: loaded.docId }
})

expectTypeOf(review.run).parameter(0).toEqualTypeOf<{ docId: string; priority?: 'low' | 'high' }>()
expectTypeOf(review.run).parameter(1).toMatchTypeOf<{ goal?: string } | undefined>()
expectTypeOf(review.resume).parameter(0).toEqualTypeOf<string>()
expectTypeOf(review.resume).parameter(1).toMatchTypeOf<{ goal?: string } | undefined>()

const reviewResult = await review.run({ docId: 'doc_123', priority: 'high' }, { goal: 'Publish review' })
if (reviewResult.status === 'completed') {
  expectTypeOf(reviewResult.output).toEqualTypeOf<{ published: boolean; docId: string }>()
}

await review.resume('flow_123')

// @ts-expect-error — input-bearing flows require the accepted input shape.
await review.run({ priority: 'high' })
// @ts-expect-error — input-bearing flows reject invalid literal values.
await review.run({ docId: 'doc_123', priority: 'urgent' })
// @ts-expect-error — resume takes a flow id, not fresh input.
await review.resume({ docId: 'doc_123' })

const nightly = flow('nightly', async (scope) => {
  return scope.step('count', () => 1)
})

await nightly.run()
await nightly.run({ goal: 'Nightly backfill' })
await nightly.resume('flow_456', { goal: 'Resume nightly' })

// @ts-expect-error — no-input flows treat the first argument as run options, not arbitrary input.
await nightly.run({ docId: 'doc_123' })
