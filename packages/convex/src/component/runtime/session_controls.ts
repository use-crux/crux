/** Convex Session lifecycle transitions: close, kill, delete, fork. */

import { initialSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import type { MutationCtx } from '../_generated/server.js'
import {
  readSession,
  replaceSession,
  sessionInputs,
  sessionRecord,
  type SessionPort,
  type SessionRecord,
} from './session_helpers'

type CloseInput = Parameters<NonNullable<SessionPort['close']>>[0]
type KillInput = Parameters<NonNullable<SessionPort['kill']>>[0]
type DeleteInput = Parameters<NonNullable<SessionPort['delete']>>[0]
type ForkInput = Parameters<NonNullable<SessionPort['fork']>>[0]

/**
 * Seal ingress, deactivate Signal subscriptions, enter closing or closed.
 *
 * @remarks Drains currently represented pending-input/work counters only.
 */
export async function closeSession(ctx: MutationCtx, input: CloseInput) {
  let row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  let session = sessionRecord(row)
  if (session.state === 'deleted') {
    throw new Error(`Session "${input.sessionId}" has been deleted.`)
  }
  await deactivateSessionSubscriptions(ctx, input.namespace, input.sessionId, input.now)
  row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  session = sessionRecord(row)
  if (
    session.state === 'closed' ||
    session.state === 'killed' ||
    session.state === 'closing'
  ) {
    return session
  }
  if (session.state !== 'ready') {
    throw new Error(
      `Session "${input.sessionId}" cannot close from state "${session.state}".`,
    )
  }
  const drained =
    session.pendingInputs === 0 &&
    session.pendingWork === 0 &&
    session.activation === undefined
  return await replaceSession(ctx, row, {
    ...session,
    state: drained ? 'closed' : 'closing',
    wakePending: drained ? false : session.wakePending,
    updatedAt: input.now.toISOString(),
  })
}

/** Fence immediately and deactivate subscriptions. */
export async function killSession(ctx: MutationCtx, input: KillInput) {
  let row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  let session = sessionRecord(row)
  if (session.state === 'deleted') {
    throw new Error(`Session "${input.sessionId}" has been deleted.`)
  }
  await deactivateSessionSubscriptions(ctx, input.namespace, input.sessionId, input.now)
  row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  session = sessionRecord(row)
  if (session.state === 'killed') return session
  const fencedWorkId = session.fencedWorkId ?? session.activation?.workId
  return await replaceSession(
    ctx,
    row,
    {
      ...session,
      state: 'killed',
      pendingInputs: 0,
      pendingWork: 0,
      blockedWork: 0,
      activation: undefined,
      wakePending: false,
      ...(fencedWorkId === undefined ? {} : { fencedWorkId }),
      updatedAt: input.now.toISOString(),
    },
    { activationWorkId: null },
  )
}

export async function deleteSession(ctx: MutationCtx, input: DeleteInput) {
  const row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  const session = sessionRecord(row)
  if (session.state === 'deleted') return session
  if (session.state !== 'closed' && session.state !== 'killed') {
    throw new Error(
      `Session "${input.sessionId}" must be closed or killed before delete.`,
    )
  }
  const inputs = await sessionInputs(ctx, input.namespace, input.sessionId)
  for (const accepted of inputs) {
    await ctx.db.delete(accepted._id)
  }
  const active = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_session_state', (q) =>
      q
        .eq('namespace', input.namespace)
        .eq('sessionId', input.sessionId)
        .eq('state', 'active'),
    )
    .collect()
  const unsubscribed = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_session_state', (q) =>
      q
        .eq('namespace', input.namespace)
        .eq('sessionId', input.sessionId)
        .eq('state', 'unsubscribed'),
    )
    .collect()
  for (const subscription of [...active, ...unsubscribed]) {
    await ctx.db.delete(subscription._id)
  }
  return await replaceSession(
    ctx,
    row,
    {
      schemaVersion: 1,
      namespace: session.namespace,
      sessionId: session.sessionId,
      keyHash: session.keyHash,
      targetId: session.targetId,
      targetKind: session.targetKind,
      threadId: session.threadId,
      state: 'deleted',
      acceptedCursor: session.acceptedCursor,
      ...(session.processedCursor === undefined
        ? {}
        : { processedCursor: session.processedCursor }),
      pendingInputs: 0,
      pendingWork: 0,
      blockedWork: 0,
      statistics: session.statistics,
      wakePending: false,
      ...(session.parentSessionId
        ? { parentSessionId: session.parentSessionId }
        : {}),
      ...(session.forkedFrom ? { forkedFrom: session.forkedFrom } : {}),
      createdAt: session.createdAt,
      updatedAt: input.now.toISOString(),
    },
    { activationWorkId: null },
  )
}

export async function forkSession(ctx: MutationCtx, input: ForkInput) {
  const parentRow = await readSession(ctx, input.namespace, input.sessionId)
  if (!parentRow) throw new Error(`Session "${input.sessionId}" was not found.`)
  const parent = sessionRecord(parentRow)
  if (
    parent.state === 'deleted' ||
    parent.state === 'closing' ||
    parent.state === 'prepared'
  ) {
    throw new Error(
      `Session "${input.sessionId}" cannot fork from state "${parent.state}".`,
    )
  }
  const existing = await readSession(ctx, input.namespace, input.childSessionId)
  if (existing) {
    const child = sessionRecord(existing)
    if (child.state === 'deleted') {
      throw new Error(
        `SESSION_TOMBSTONED: Session "${input.childSessionId}" is tombstoned and cannot be resurrected by fork.`,
      )
    }
    if (
      child.parentSessionId !== parent.sessionId ||
      child.targetId !== parent.targetId ||
      child.threadId !== parent.threadId
    ) {
      throw new Error(
        `Session fork "${input.childSessionId}" conflicts with an existing identity.`,
      )
    }
    return { parent, child }
  }
  const now = input.now.toISOString()
  const child: SessionRecord = {
    schemaVersion: 1,
    namespace: parent.namespace,
    sessionId: input.childSessionId,
    keyHash: input.childKeyHash,
    targetId: parent.targetId,
    targetKind: parent.targetKind,
    threadId: parent.threadId,
    ...(parent.model === undefined ? {} : { model: parent.model }),
    ...(parent.definition === undefined ? {} : { definition: parent.definition }),
    state: 'ready',
    acceptedCursor: 0,
    pendingInputs: 0,
    pendingWork: 0,
    blockedWork: 0,
    statistics: initialSessionStatistics(input.childSessionId, input.now),
    wakePending: false,
    parentSessionId: parent.sessionId,
    forkedFrom: {
      sessionId: parent.sessionId,
      cursor: parent.acceptedCursor,
      threadRevision: input.threadRevision,
    },
    createdAt: now,
    updatedAt: now,
  }
  await ctx.db.insert('runtimeSessions', child)
  return { parent, child }
}

export async function listSessionForks(
  ctx: MutationCtx,
  namespace: string,
  sessionId: string,
) {
  const rows = await ctx.db
    .query('runtimeSessions')
    .withIndex('by_namespace_parent', (q) =>
      q.eq('namespace', namespace).eq('parentSessionId', sessionId),
    )
    .collect()
  return rows
    .map(sessionRecord)
    .filter((session) => session.state !== 'deleted')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function maybeFinalizeClosingSession(
  session: SessionRecord,
  now: Date,
): SessionRecord {
  if (session.state !== 'closing') return session
  if (
    session.pendingInputs > 0 ||
    session.pendingWork > 0 ||
    session.activation !== undefined
  ) {
    return session
  }
  return {
    ...session,
    state: 'closed',
    wakePending: false,
    updatedAt: now.toISOString(),
  }
}

export function sessionAcceptsWorkMutation(session: SessionRecord): boolean {
  return session.state === 'ready' || session.state === 'closing'
}

async function deactivateSessionSubscriptions(
  ctx: MutationCtx,
  namespace: string,
  sessionId: string,
  now: Date,
) {
  const active = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_session_state', (q) =>
      q.eq('namespace', namespace).eq('sessionId', sessionId).eq('state', 'active'),
    )
    .collect()
  const updatedAt = now.toISOString()
  for (const subscription of active) {
    await ctx.db.patch(subscription._id, {
      state: 'unsubscribed' as const,
      updatedAt,
    })
  }
}
