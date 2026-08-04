import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'

export type SessionPort = NonNullable<RuntimeStoreTransaction['sessions']>
export type SessionRecord = NonNullable<Awaited<ReturnType<SessionPort['get']>>>
export type SessionInputRecord = NonNullable<Awaited<ReturnType<SessionPort['getInput']>>>

export async function readSession(ctx: MutationCtx, namespace: string, sessionId: string) {
  return await ctx.db
    .query('runtimeSessions')
    .withIndex('by_namespace_session', (q) => q.eq('namespace', namespace).eq('sessionId', sessionId))
    .unique()
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof readSession>>>
type InputRow = NonNullable<Awaited<ReturnType<typeof readInput>>>

/** Decode a component document into the canonical Core Session record. */
export function sessionRecord(row: SessionRow): SessionRecord {
  return {
    schemaVersion: 1,
    namespace: row.namespace,
    sessionId: row.sessionId,
    keyHash: row.keyHash,
    targetId: row.targetId,
    threadId: row.threadId,
    model: row.model,
    state: row.state,
    acceptedCursor: row.acceptedCursor,
    ...(row.processedCursor === undefined ? {} : { processedCursor: row.processedCursor }),
    pendingInputs: row.pendingInputs,
    pendingWork: row.pendingWork,
    blockedWork: row.blockedWork,
    statistics: row.statistics,
    wakePending: row.wakePending,
    ...(row.activation === undefined ? {} : { activation: row.activation }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Decode a component document into the canonical Core Session input record. */
export function sessionInputRecord(row: InputRow): SessionInputRecord {
  return {
    schemaVersion: 1,
    namespace: row.namespace,
    sessionId: row.sessionId,
    inputId: row.inputId,
    cursor: row.cursor,
    input: row.input,
    acceptedAt: row.acceptedAt,
    ...(row.work === undefined ? {} : { work: row.work }),
    ...(row.delivery === undefined ? {} : { delivery: row.delivery }),
    ...(row.preparedExecution === undefined ? {} : { preparedExecution: row.preparedExecution }),
  }
}

/** Add the indexed projections stored alongside one canonical input record. */
export function sessionInputDocument(record: SessionInputRecord) {
  return {
    ...record,
    ...(record.work ? { workId: record.work.workId } : {}),
    ...(record.preparedExecution
      ? {
          preparedResultLocation: record.preparedExecution.preparedResultRef.location,
        }
      : {}),
  }
}

export async function readInput(ctx: MutationCtx, namespace: string, sessionId: string, inputId: string) {
  const row = await ctx.db
    .query('runtimeSessionInputs')
    .withIndex('by_namespace_input', (q) => q.eq('namespace', namespace).eq('inputId', inputId))
    .unique()
  return row?.sessionId === sessionId ? row : null
}

export async function replaceSession(
  ctx: MutationCtx,
  row: NonNullable<Awaited<ReturnType<typeof readSession>>>,
  next: SessionRecord,
) {
  await ctx.db.replace(row._id, next)
  return next
}

export async function sessionInputs(ctx: MutationCtx, namespace: string, sessionId: string) {
  return await ctx.db
    .query('runtimeSessionInputs')
    .withIndex('by_session_cursor', (q) => q.eq('namespace', namespace).eq('sessionId', sessionId))
    .collect()
}

export async function workInputs(ctx: MutationCtx, namespace: string, sessionId: string, workId: string) {
  return await ctx.db
    .query('runtimeSessionInputs')
    .withIndex('by_session_work_cursor', (q) =>
      q.eq('namespace', namespace).eq('sessionId', sessionId).eq('workId', workId),
    )
    .collect()
}
