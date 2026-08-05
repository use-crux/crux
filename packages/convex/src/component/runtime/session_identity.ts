import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import { initialSessionStatistics, recordSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import type { MutationCtx } from '../_generated/server.js'
import {
  readInput,
  readSession,
  replaceSession,
  sessionInputDocument,
  sessionInputRecord,
  sessionRecord,
  type SessionInputRecord,
  type SessionPort,
  type SessionRecord,
} from './session_helpers'

type CreateInput = Parameters<SessionPort['create']>[0]
type AcceptInput = Parameters<SessionPort['acceptInputs']>[0]
type ReserveInput = Parameters<SessionPort['reserveTurn']>[0]

/** Create or resolve one keyed Session identity in the current mutation. */
export async function createSession(ctx: MutationCtx, input: CreateInput) {
  const existing = await ctx.db
    .query('runtimeSessions')
    .withIndex('by_namespace_key', (q) => q.eq('namespace', input.namespace).eq('keyHash', input.keyHash))
    .unique()
  if (existing) {
    const session = sessionRecord(existing)
    return existing.targetId === input.targetId
      ? { kind: 'existing' as const, session }
      : { kind: 'conflict' as const, session }
  }
  const timestamp = input.now.toISOString()
  const session: SessionRecord = {
    schemaVersion: 1,
    namespace: input.namespace,
    sessionId: input.sessionId,
    keyHash: input.keyHash,
    targetId: input.targetId,
    targetKind: input.targetKind,
    threadId: input.threadId,
    ...(input.model === undefined ? {} : { model: { ...input.model } }),
    ...(input.definition === undefined
      ? {}
      : { definition: { ...input.definition } }),
    state: 'prepared',
    acceptedCursor: 0,
    pendingInputs: 0,
    pendingWork: 0,
    blockedWork: 0,
    statistics: initialSessionStatistics(input.sessionId, input.now),
    wakePending: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await ctx.db.insert('runtimeSessions', {
    ...session,
    ...(session.activation
      ? { activationWorkId: session.activation.workId }
      : {}),
  })
  return { kind: 'created' as const, session }
}

export async function getSessionByKey(ctx: MutationCtx, namespace: string, keyHash: string) {
  const row = await ctx.db
    .query('runtimeSessions')
    .withIndex('by_namespace_key', (q) => q.eq('namespace', namespace).eq('keyHash', keyHash))
    .unique()
  return row ? sessionRecord(row) : null
}

export async function getSession(ctx: MutationCtx, namespace: string, sessionId: string) {
  const row = await readSession(ctx, namespace, sessionId)
  return row ? sessionRecord(row) : null
}

export async function getSessionInput(ctx: MutationCtx, namespace: string, sessionId: string, inputId: string) {
  const row = await readInput(ctx, namespace, sessionId, inputId)
  return row ? sessionInputRecord(row) : null
}

export async function getSessionInputAtCursor(ctx: MutationCtx, namespace: string, sessionId: string, cursor: number) {
  const row = await ctx.db
    .query('runtimeSessionInputs')
    .withIndex('by_session_cursor', (q) => q.eq('namespace', namespace).eq('sessionId', sessionId).eq('cursor', cursor))
    .unique()
  return row ? sessionInputRecord(row) : null
}

export async function inspectSessionInputs(ctx: MutationCtx, namespace: string, sessionId: string, limit: number) {
  const normalized = Math.max(0, Math.floor(limit))
  const rows = await ctx.db
    .query('runtimeSessionInputs')
    .withIndex('by_session_cursor', (q) => q.eq('namespace', namespace).eq('sessionId', sessionId))
    .order('desc')
    .take(normalized + 1)
  const truncated = rows.length > normalized
  return {
    inputs: rows.slice(0, normalized).reverse().map(sessionInputRecord),
    truncated,
  }
}

export async function markSessionReady(ctx: MutationCtx, namespace: string, sessionId: string, now: Date) {
  const row = await readSession(ctx, namespace, sessionId)
  if (!row) throw new Error(`Session "${sessionId}" was not found.`)
  if (row.state === 'ready') return sessionRecord(row)
  const next: SessionRecord = {
    ...sessionRecord(row),
    state: 'ready',
    updatedAt: now.toISOString(),
  }
  return await replaceSession(ctx, row, next)
}

/** Append a validated group and advance its cursor atomically. */
export async function acceptSessionInputs(ctx: MutationCtx, input: AcceptInput) {
  const row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  if (row.state !== 'ready') throw new Error(`Session "${input.sessionId}" is not ready.`)
  const acceptedAt = input.now.toISOString()
  const accepted: SessionInputRecord[] = input.inputs.map((value, index) => ({
    schemaVersion: 1,
    namespace: input.namespace,
    sessionId: input.sessionId,
    inputId: `input_${input.sessionId}_${row.acceptedCursor + index + 1}`,
    cursor: row.acceptedCursor + index + 1,
    input: value,
    acceptedAt,
  }))
  for (const record of accepted) await ctx.db.insert('runtimeSessionInputs', sessionInputDocument(record))
  await replaceSession(ctx, row, {
    ...sessionRecord(row),
    acceptedCursor: row.acceptedCursor + accepted.length,
    pendingInputs: row.pendingInputs + accepted.length,
    wakePending: true,
    updatedAt: acceptedAt,
  })
  return accepted
}

/** Reserve one canonical activation before its Work row is created. */
export async function reserveSessionTurn(ctx: MutationCtx, input: ReserveInput) {
  const row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  if (row.activation) return row.activation
  const accepted = await readInput(ctx, input.namespace, input.sessionId, input.inputId)
  if (!accepted) throw new Error(`Session input "${input.inputId}" was not found.`)
  const activation = {
    workId: input.workId,
    primaryInputId: input.inputId,
    target: input.target,
    state: 'queued' as const,
  }
  await replaceSession(
    ctx,
    row,
    {
      ...sessionRecord(row),
      activation,
      pendingWork: row.pendingWork + 1,
      statistics: recordSessionStatistics(row.statistics, row.sessionId, input.now, [
        { kind: 'work-accepted', target: input.target, state: 'queued' },
      ]),
      wakePending: true,
      updatedAt: input.now.toISOString(),
    },
    { activationWorkId: activation.workId },
  )
  return activation
}

export async function getSessionByActivationWorkId(
  ctx: MutationCtx,
  namespace: string,
  workId: string,
) {
  const row = await ctx.db
    .query('runtimeSessions')
    .withIndex('by_namespace_activation_work', (q) =>
      q.eq('namespace', namespace).eq('activationWorkId', workId),
    )
    .unique()
  return row ? sessionRecord(row) : null
}
