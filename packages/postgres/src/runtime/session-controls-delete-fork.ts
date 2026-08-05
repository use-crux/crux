/** PostgreSQL Session delete/fork transitions. */

import { initialSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeSessionRecord } from './session-codec'
import { readSession, writeSession } from './session-records'
import type { PostgresSessionStore, RuntimeSessionRecord } from './session-types'
import type { PgExecutor } from './sql'
import { table } from './sql'

type DeleteInput = NonNullable<PostgresSessionStore['delete']> extends (
  input: infer T,
) => unknown
  ? T
  : never
type ForkInput = NonNullable<PostgresSessionStore['fork']> extends (
  input: infer T,
) => unknown
  ? T
  : never

export async function deletePostgresSession(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: DeleteInput,
): Promise<RuntimeSessionRecord> {
  const session = await requireSession(db, schema, input)
  if (session.state === 'deleted') return session
  if (session.state !== 'closed' && session.state !== 'killed') {
    throw new Error(
      `Session "${input.sessionId}" must be closed or killed before delete.`,
    )
  }
  recordWrite(faults)
  await db.query(
    `DELETE FROM ${table(schema, 'session_inputs')}
      WHERE namespace = $1 AND session_id = $2`,
    [input.namespace, input.sessionId],
  )
  await db.query(
    `DELETE FROM ${table(schema, 'session_subscriptions')}
      WHERE namespace = $1 AND session_id = $2`,
    [input.namespace, input.sessionId],
  )
  return await writeSession(
    db,
    schema,
    faults,
    Object.freeze({
      schemaVersion: 1 as const,
      namespace: session.namespace,
      sessionId: session.sessionId,
      keyHash: session.keyHash,
      targetId: session.targetId,
      targetKind: session.targetKind,
      threadId: session.threadId,
      state: 'deleted' as const,
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
    }),
  )
}

export async function forkPostgresSession(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: ForkInput,
) {
  const parent = await requireSession(db, schema, input)
  if (
    parent.state === 'deleted' ||
    parent.state === 'closing' ||
    parent.state === 'prepared'
  ) {
    throw new Error(
      `Session "${input.sessionId}" cannot fork from state "${parent.state}".`,
    )
  }
  const existing = await readSession(
    db,
    schema,
    input.namespace,
    input.childSessionId,
  )
  if (existing) {
    if (existing.state === 'deleted') {
      throw new Error(
        `SESSION_TOMBSTONED: Session "${input.childSessionId}" is tombstoned and cannot be resurrected by fork.`,
      )
    }
    if (
      existing.parentSessionId !== parent.sessionId ||
      existing.targetId !== parent.targetId ||
      existing.threadId !== parent.threadId
    ) {
      throw new Error(
        `Session fork "${input.childSessionId}" conflicts with an existing identity.`,
      )
    }
    return Object.freeze({ parent, child: existing })
  }
  const now = input.now.toISOString()
  const child: RuntimeSessionRecord = Object.freeze({
    schemaVersion: 1,
    namespace: parent.namespace,
    sessionId: input.childSessionId,
    keyHash: input.childKeyHash,
    targetId: parent.targetId,
    targetKind: parent.targetKind,
    threadId: parent.threadId,
    ...(parent.model ? { model: parent.model } : {}),
    ...(parent.definition ? { definition: parent.definition } : {}),
    state: 'ready',
    acceptedCursor: 0,
    pendingInputs: 0,
    pendingWork: 0,
    blockedWork: 0,
    statistics: initialSessionStatistics(input.childSessionId, input.now),
    wakePending: false,
    parentSessionId: parent.sessionId,
    forkedFrom: Object.freeze({
      sessionId: parent.sessionId,
      cursor: parent.acceptedCursor,
      threadRevision: input.threadRevision,
    }),
    createdAt: now,
    updatedAt: now,
  })
  recordWrite(faults)
  await db.query(
    `INSERT INTO ${table(schema, 'sessions')}
      (namespace, session_id, key_hash, target_id, target_kind, thread_id,
       model, definition, state, accepted_cursor, pending_inputs, pending_work,
       blocked_work, statistics, wake_pending, parent_session_id, forked_from,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'ready',0,0,0,0,$9::jsonb,
             false,$10,$11::jsonb,$12,$12)`,
    [
      child.namespace,
      child.sessionId,
      child.keyHash,
      child.targetId,
      child.targetKind,
      child.threadId,
      child.model === undefined ? null : encodeJson(child.model),
      child.definition === undefined ? null : encodeJson(child.definition),
      encodeJson(child.statistics),
      child.parentSessionId,
      encodeJson(child.forkedFrom),
      now,
    ],
  )
  return Object.freeze({ parent, child })
}

export async function listPostgresSessionForks(
  db: PgExecutor,
  schema: string,
  namespace: string,
  sessionId: string,
): Promise<readonly RuntimeSessionRecord[]> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${table(schema, 'sessions')}
      WHERE namespace = $1 AND parent_session_id = $2 AND state <> 'deleted'
      ORDER BY created_at ASC`,
    [namespace, sessionId],
  )
  return Object.freeze(result.rows.map(decodeSessionRecord))
}

async function requireSession(
  db: PgExecutor,
  schema: string,
  input: { readonly namespace: string; readonly sessionId: string },
): Promise<RuntimeSessionRecord> {
  const session = await readSession(
    db,
    schema,
    input.namespace,
    input.sessionId,
    true,
  )
  if (!session) throw new Error(`Session "${input.sessionId}" was not found.`)
  return session
}
