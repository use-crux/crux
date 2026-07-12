import type {
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
  RuntimeDeferredStorePort,
} from '@use-crux/core/runtime'
import type { WithoutSystemFields } from 'convex/server'
import type { Doc } from '../_generated/dataModel.js'
import type { MutationCtx } from '../_generated/server.js'
import {
  decodeDeferredIntent,
  decodeDeferredScope,
  encodeDeferredIntent,
  encodeDeferredScope,
} from '../../runtime-engine/codec'
import { limitRows } from './shared'

type DeferredScopeRow = WithoutSystemFields<Doc<'runtimeDeferredScopes'>>
type DeferredIntentRow = WithoutSystemFields<Doc<'runtimeDeferredIntents'>>

export function createCompositeDeferredStore(
  ctx: MutationCtx,
): RuntimeDeferredStorePort {
  return {
    getScope: async (scopeId, options) => {
      const scope = await scopeRecord(ctx, options.namespace, scopeId)
      return scope ? decodeDeferredScope(scope) : null
    },
    putScope: (scope) => putScopeRecord(ctx, scope),
    listScopes: async (options) => {
      const rows = options.state
        ? await ctx.db
            .query('runtimeDeferredScopes')
            .withIndex('by_namespace_state_expiry', (q) =>
              q
                .eq('namespace', options.namespace)
                .eq('finalizationState', options.state!),
            )
            .take(options.limit ?? 1_000)
        : await ctx.db
            .query('runtimeDeferredScopes')
            .withIndex('by_scope', (q) => q.eq('namespace', options.namespace))
            .take(options.limit ?? 1_000)
      return limitRows(
        rows
          .filter(
            (row) =>
              options.leaseExpiresBefore === undefined ||
              row.leaseExpiresAt < options.leaseExpiresBefore.getTime(),
          )
          .map(decodeDeferredScope),
        options.limit,
      )
    },
    getIntent: async (intentId, options) => {
      const intent = await intentRecord(ctx, options.namespace, intentId)
      return intent ? decodeDeferredIntent(intent) : null
    },
    putIntent: (intent) => putIntentRecord(ctx, intent),
    listIntents: async (options) => {
      const rows = await ctx.db
        .query('runtimeDeferredIntents')
        .withIndex('by_scope_state', (q) => {
          const scope = q
            .eq('namespace', options.namespace)
            .eq('scopeId', options.scopeId)
          return options.state ? scope.eq('state', options.state) : scope
        })
        .take(options.limit ?? 1_000)
      return limitRows(rows.map(decodeDeferredIntent), options.limit)
    },
  }
}

async function putScopeRecord(
  ctx: MutationCtx,
  scope: RuntimeDeferredScope,
): Promise<void> {
  const existing = await scopeRecord(ctx, scope.namespace, scope.scopeId)
  const encoded = encodeDeferredScope(scope) as DeferredScopeRow
  if (existing) await ctx.db.replace(existing._id, encoded)
  else await ctx.db.insert('runtimeDeferredScopes', encoded)
}

async function putIntentRecord(
  ctx: MutationCtx,
  intent: RuntimeDeferredIntent,
): Promise<void> {
  const existing = await intentRecord(ctx, intent.namespace, intent.intentId)
  const encoded = encodeDeferredIntent(intent) as DeferredIntentRow
  if (existing) await ctx.db.replace(existing._id, encoded)
  else await ctx.db.insert('runtimeDeferredIntents', encoded)
}

async function scopeRecord(
  ctx: MutationCtx,
  namespace: string,
  scopeId: string,
) {
  return await ctx.db
    .query('runtimeDeferredScopes')
    .withIndex('by_scope', (q) =>
      q.eq('namespace', namespace).eq('scopeId', scopeId),
    )
    .first()
}

async function intentRecord(
  ctx: MutationCtx,
  namespace: string,
  intentId: string,
) {
  return await ctx.db
    .query('runtimeDeferredIntents')
    .withIndex('by_intent', (q) =>
      q.eq('namespace', namespace).eq('intentId', intentId),
    )
    .first()
}
