import { v } from 'convex/values'
import {
  runtimeCompositeBodies,
  type RuntimeCompositeBody,
  type RuntimeCompositeInput,
  type RuntimeCompositeKind,
  type RuntimeCompositeDeps,
  type RuntimeCompositeResult,
} from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import { mutation } from '../_generated/server.js'
import {
  decodeCompositeValue,
  encodeCompositeValue,
} from '../../runtime-engine/codec'
import { createConvexWorkIdGenerator } from '../../runtime-engine/helpers'
import { createCompositeTransaction } from './composite_transaction'

/** Run one kernel-owned Runtime Engine composite in a single Convex mutation. */
export const run = mutation({
  args: { kind: v.string(), input: v.any() },
  returns: v.any(),
  handler: async (ctx, { kind, input }) => {
    const result = await runCompositeBody(ctx, assertCompositeKind(kind), input)
    return encodeCompositeValue(result)
  },
})

async function runCompositeBody<K extends RuntimeCompositeKind>(
  ctx: MutationCtx,
  kind: K,
  input: unknown,
): Promise<RuntimeCompositeResult[K]> {
  const body = runtimeCompositeBodies[kind] as RuntimeCompositeBody<K>
  const deps: RuntimeCompositeDeps = {
    now: () => new Date(),
    newWorkId: createConvexWorkIdGenerator(),
  }
  return await body(
    createCompositeTransaction(ctx),
    deps,
    decodeCompositeValue<RuntimeCompositeInput[K]>(input),
  )
}

function assertCompositeKind(kind: string): RuntimeCompositeKind {
  if (kind in runtimeCompositeBodies) return kind as RuntimeCompositeKind
  throw new Error(`Unknown Runtime Engine composite kind \`${kind}\`.`)
}

export type {
  RuntimeCompositeInput,
  RuntimeCompositeKind,
  RuntimeCompositeResult,
}
