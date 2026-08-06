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
            updated_at = $12
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
      session.updatedAt,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Session "${session.sessionId}" was not found.`)
  return decodeSessionRecord(row)
}
