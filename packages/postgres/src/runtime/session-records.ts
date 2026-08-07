import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeSessionInputRecord, decodeSessionRecord } from './session-codec'
import type {
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
} from './session-types'
import { encodeJson } from './codec'
import type { PgExecutor } from './sql'
import { table } from './sql'

export async function readSession(
  db: PgExecutor,
  schema: string,
  namespace: string,
  sessionId: string,
  lock = false,
): Promise<RuntimeSessionRecord | null> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${table(schema, 'sessions')}
      WHERE namespace = $1 AND session_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [namespace, sessionId],
  )
  return result.rows[0] ? decodeSessionRecord(result.rows[0]) : null
}

export async function readSessionInput(
  db: PgExecutor,
  schema: string,
  namespace: string,
  sessionId: string,
  inputId: string,
): Promise<RuntimeSessionInputRecord | null> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${table(schema, 'session_inputs')}
      WHERE namespace = $1 AND session_id = $2 AND input_id = $3`,
    [namespace, sessionId, inputId],
  )
  return result.rows[0] ? decodeSessionInputRecord(result.rows[0]) : null
}

export async function listSessionInputs(
  db: PgExecutor,
  schema: string,
  namespace: string,
  sessionId: string,
  afterCursor = 0,
): Promise<readonly RuntimeSessionInputRecord[]> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${table(schema, 'session_inputs')}
      WHERE namespace = $1 AND session_id = $2 AND cursor > $3
      ORDER BY cursor ASC`,
    [namespace, sessionId, afterCursor],
  )
  return Object.freeze(result.rows.map(decodeSessionInputRecord))
}

export async function listTurnInputs(
  db: PgExecutor,
  schema: string,
  namespace: string,
  sessionId: string,
  workId: string,
): Promise<readonly RuntimeSessionInputRecord[]> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${table(schema, 'session_inputs')}
      WHERE namespace = $1 AND session_id = $2
        AND work ->> 'workId' = $3
      ORDER BY cursor ASC`,
    [namespace, sessionId, workId],
  )
  return Object.freeze(result.rows.map(decodeSessionInputRecord))
}

export async function writeSession(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  session: RuntimeSessionRecord,
): Promise<RuntimeSessionRecord> {
  recordWrite(faults)
  const result = await db.query<Record<string, unknown>>(
    `UPDATE ${table(schema, 'sessions')}
        SET state = $3,
            accepted_cursor = $4,
            processed_cursor = $5,
            pending_inputs = $6,
            pending_work = $7,
            blocked_work = $8,
            statistics = $9::jsonb,
            wake_pending = $10,
            activation = $11::jsonb,
            fenced_work_id = $12,
            updated_at = $13
      WHERE namespace = $1 AND session_id = $2
      RETURNING *`,
    [
      session.namespace,
      session.sessionId,
      session.state,
      session.acceptedCursor,
      session.processedCursor ?? null,
      session.pendingInputs,
      session.pendingWork,
      session.blockedWork,
      encodeJson(session.statistics),
      session.wakePending,
      session.activation ? encodeJson(session.activation) : null,
      session.fencedWorkId ?? null,
      session.updatedAt,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Session "${session.sessionId}" was not found.`)
  return decodeSessionRecord(row)
}

/**
 * Update only lifecycle fields so concurrent settlement counters are preserved.
 *
 * @remarks Used by close/closing transitions under a row lock.
 */
export async function writeSessionCloseState(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: {
    readonly namespace: string
    readonly sessionId: string
    readonly state: 'closing' | 'closed'
    readonly wakePending: boolean
    readonly updatedAt: string
  },
): Promise<RuntimeSessionRecord> {
  recordWrite(faults)
  const result = await db.query<Record<string, unknown>>(
    `UPDATE ${table(schema, 'sessions')}
        SET state = $3,
            wake_pending = $4,
            updated_at = $5
      WHERE namespace = $1 AND session_id = $2
      RETURNING *`,
    [
      input.namespace,
      input.sessionId,
      input.state,
      input.wakePending,
      input.updatedAt,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  return decodeSessionRecord(row)
}

/**
 * Apply kill fence without replaying a stale full-record snapshot.
 *
 * @remarks Zeros pending counters and clears activation under the row lock.
 */
export async function writeSessionKillState(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: {
    readonly namespace: string
    readonly sessionId: string
    readonly fencedWorkId: string | null
    readonly updatedAt: string
  },
): Promise<RuntimeSessionRecord> {
  recordWrite(faults)
  const result = await db.query<Record<string, unknown>>(
    `UPDATE ${table(schema, 'sessions')}
        SET state = 'killed',
            pending_inputs = 0,
            pending_work = 0,
            blocked_work = 0,
            activation = NULL,
            wake_pending = false,
            fenced_work_id = COALESCE($3, fenced_work_id),
            updated_at = $4
      WHERE namespace = $1 AND session_id = $2
      RETURNING *`,
    [
      input.namespace,
      input.sessionId,
      input.fencedWorkId,
      input.updatedAt,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  return decodeSessionRecord(row)
}
