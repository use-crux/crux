/**
 * Type-level contract for the Convex flow adapter surface.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { noPayload } from '@use-crux/core/flow'
import { flow } from '../src/server'

const approvalSchema = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
})

const reviewFlow = flow({
  name: 'convex-review',
  args: { draftId: 'validator-placeholder' },
  signals: {
    approval: approvalSchema,
    cancel: noPayload(),
  },
  handler: async (scope, args: { draftId: string }) => {
    expectTypeOf(scope.input.draftId).toEqualTypeOf<string>()
    expectTypeOf(args.draftId).toEqualTypeOf<string>()

    const approval = await scope.suspend('approval')
    expectTypeOf(approval).toEqualTypeOf<{
      approved: boolean
      note?: string
    }>()

    const cancel = await scope.suspend('cancel')
    expectTypeOf(cancel).toEqualTypeOf<void>()

    // @ts-expect-error typed Convex flow signal maps reject unknown suspend names.
    await scope.suspend('approvl')

    return approval.approved
  },
})

type ReviewSignalName = Parameters<typeof reviewFlow.signal>[3]
expectTypeOf<ReviewSignalName>().toEqualTypeOf<'approval' | 'cancel'>()

const ctx = {
  scheduler: {
    runAfter: async () => undefined,
  },
}

await reviewFlow.signal(ctx, reviewFlow.action, 'flow_123', 'approval', { approved: true })
await reviewFlow.signal(ctx, reviewFlow.action, 'flow_123', 'cancel')

// @ts-expect-error payload-bearing signals require a payload.
await reviewFlow.signal(ctx, reviewFlow.action, 'flow_123', 'approval')
// @ts-expect-error payloads are inferred from the signal schema.
await reviewFlow.signal(ctx, reviewFlow.action, 'flow_123', 'approval', { approved: 'yes' })
// @ts-expect-error noPayload() signals do not accept a payload.
await reviewFlow.signal(ctx, reviewFlow.action, 'flow_123', 'cancel', {})
// @ts-expect-error typed Convex flow signal maps reject unknown signal names.
await reviewFlow.signal(ctx, reviewFlow.action, 'flow_123', 'approvl', { approved: true })
