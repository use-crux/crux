/**
 * Type-level contract for the Flows beta public API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { flow, noPayload, task as planTask } from '@use-crux/core'
import { durableTask } from '@use-crux/core/runtime'

const review = flow('review', async (scope, input: { docId: string; priority?: 'low' | 'high' }) => {
  const loaded = await scope.step('load', () => ({ docId: input.docId }))
  const approval = await scope.waitFor<{ docId: string; approvedBy: string }>('document.approved', {
    match: { docId: input.docId },
  })
  expectTypeOf(approval.approvedBy).toEqualTypeOf<string>()
  return { published: input.priority === 'high', docId: loaded.docId }
})

expectTypeOf(review.run).parameter(0).toEqualTypeOf<{ docId: string; priority?: 'low' | 'high' }>()
expectTypeOf(review.run).parameter(1).toMatchTypeOf<{ goal?: string } | undefined>()
expectTypeOf(review.resume).parameter(0).toEqualTypeOf<string>()
expectTypeOf(review.resume).parameter(1).toMatchTypeOf<{ goal?: string } | undefined>()

const reviewResult = await review.run({ docId: 'doc_123', priority: 'high' }, { goal: 'Publish review' })
if (reviewResult.status === 'completed') {
  expectTypeOf(reviewResult.output).toEqualTypeOf<{
    published: boolean
    docId: string
  }>()
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

const approvalSchema = z.object({
  approved: z.boolean(),
  comment: z.string().optional(),
})

const signaledReview = flow(
  'signaled review',
  {
    signals: {
      approval: approvalSchema,
      cancel: noPayload(),
    },
  },
  async (scope, input: { docId: string }) => {
    const approval = await scope.suspend('approval')
    expectTypeOf(approval).toEqualTypeOf<{
      approved: boolean
      comment?: string
    }>()
    expectTypeOf(input.docId).toEqualTypeOf<string>()

    const cancelled = await scope.suspend('cancel')
    expectTypeOf(cancelled).toEqualTypeOf<void>()

    // @ts-expect-error — typed signal maps reject unknown suspend names.
    await scope.suspend('approvl')

    return approval.approved
  },
)

type SignaledReviewSignalName = Parameters<typeof signaledReview.signal>[1]
expectTypeOf<SignaledReviewSignalName>().toEqualTypeOf<'approval' | 'cancel'>()

await signaledReview.run({ docId: 'doc_123' })
await signaledReview.resume('flow_123')
await signaledReview.signal('flow_123', 'approval', { approved: true })
await signaledReview.signal('flow_123', 'approval', { approved: true }, { resume: false })
await signaledReview.signal('flow_123', 'cancel')
await signaledReview.signal('flow_123', 'cancel', { resume: false })

// @ts-expect-error — payload-bearing signals require their payload.
await signaledReview.signal('flow_123', 'approval')
// @ts-expect-error — payloads are inferred from the signal schema.
await signaledReview.signal('flow_123', 'approval', { approved: 'yes' })
// @ts-expect-error — noPayload() signals do not accept a payload.
await signaledReview.signal('flow_123', 'cancel', {})
// @ts-expect-error — signal options must name the resume behavior when present.
await signaledReview.signal('flow_123', 'cancel', { other: false })
// @ts-expect-error — typed signal maps reject unknown signal names.
await signaledReview.signal('flow_123', 'approvl', { approved: true })

const embedDocument = durableTask('embed-document', {
  run: async (input: { documentId: string }) => input.documentId,
})
const planLedgerTask = planTask('Embed document')

const runtimeApiFlow = flow('runtime api flow', async (scope) => {
  const child = await scope.defer(embedDocument, { documentId: 'doc_1' })
  expectTypeOf(child.workId).toEqualTypeOf<string>()
  await scope.after(embedDocument, '1h', { documentId: 'doc_1' })
  await scope.untilIdle({ scope: 'current-flow' })

  // @ts-expect-error — durable defer accepts only durable task targets from @use-crux/core/runtime.
  await scope.defer(planLedgerTask, { documentId: 'doc_1' })
  // @ts-expect-error — task input is inferred from the durable task target.
  await scope.defer(embedDocument, { documentID: 'doc_1' })
})
void runtimeApiFlow
