/** PostgreSQL Session close/kill transitions. */

import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import {
  readSession,
  writeSessionCloseState,
  writeSessionKillState,
} from './session-records'
import type { PostgresSessionStore, RuntimeSessionRecord } from './session-types'
import type { PgExecutor } from './sql'
import { table } from './sql'

type CloseInput = NonNullable<PostgresSessionStore['close']> extends (
  input: infer T,
) => unknown
  ? T
  : never
type KillInput = NonNullable<PostgresSessionStore['kill']> extends (
  input: infer T,
) => unknown
  ? T
  : never

/**
 * Seal ingress, deactivate Signal subscriptions, enter closing or closed.
 *
 * @remarks Under row lock, re-reads after deactivation and writes only state
 * fields so settlement counters are preserved.
 */
export async function closePostgresSession(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: CloseInput,
): Promise<RuntimeSessionRecord> {
  let session = await requireSession(db, schema, input)
  if (session.state === 'deleted') {
    throw new Error(`Session "${input.sessionId}" has been deleted.`)
  }
  await deactivateSessionSubscriptions(db, schema, faults, input)
  session = await requireSession(db, schema, input)
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
  return await writeSessionCloseState(db, schema, faults, {
    namespace: input.namespace,
    sessionId: input.sessionId,
    state: drained ? 'closed' : 'closing',
    wakePending: drained ? false : session.wakePending,
    updatedAt: input.now.toISOString(),
  })
}

/** Fence immediately and deactivate subscriptions, retaining fenced Work. */
export async function killPostgresSession(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: KillInput,
): Promise<RuntimeSessionRecord> {
  let session = await requireSession(db, schema, input)
  if (session.state === 'deleted') {
    throw new Error(`Session "${input.sessionId}" has been deleted.`)
  }
  await deactivateSessionSubscriptions(db, schema, faults, input)
  session = await requireSession(db, schema, input)
  if (session.state === 'killed') return session
  const fencedWorkId = session.fencedWorkId ?? session.activation?.workId ?? null
  return await writeSessionKillState(db, schema, faults, {
    namespace: input.namespace,
    sessionId: input.sessionId,
    fencedWorkId,
    updatedAt: input.now.toISOString(),
  })
}

export function maybeFinalizeClosingSession(
  session: RuntimeSessionRecord,
  now: Date,
): RuntimeSessionRecord {
  if (session.state !== 'closing') return session
  if (
    session.pendingInputs > 0 ||
    session.pendingWork > 0 ||
    session.activation !== undefined
  ) {
    return session
  }
  return Object.freeze({
    ...session,
    state: 'closed' as const,
    wakePending: false,
    updatedAt: now.toISOString(),
  })
}

export function sessionAcceptsWorkMutation(
  session: RuntimeSessionRecord,
): boolean {
  return session.state === 'ready' || session.state === 'closing'
}

async function deactivateSessionSubscriptions(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: {
    readonly namespace: string
    readonly sessionId: string
    readonly now: Date
  },
): Promise<void> {
  recordWrite(faults)
  await db.query(
    `UPDATE ${table(schema, 'session_subscriptions')}
        SET state = 'unsubscribed', updated_at = $3
      WHERE namespace = $1 AND session_id = $2 AND state = 'active'`,
    [input.namespace, input.sessionId, input.now.toISOString()],
  )
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
