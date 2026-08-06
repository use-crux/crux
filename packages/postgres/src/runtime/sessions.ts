import { initialSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import {
  claimSessionStepInputs,
  reserveSessionTurn,
  startSessionTurn,
} from './session-lifecycle'
import {
  listTurnInputs,
  readSession,
  readSessionInput,
  writeSession,
} from './session-records'
import { settleSessionTurn } from './session-settlement'
import {
  decodePreparedExecution,
  decodeSessionInputRecord,
  decodeSessionRecord,
} from './session-codec'
import { createPostgresSessionSubscriptionMethods } from './session-subscriptions'
import type {
  PostgresSessionStore,
  RuntimeSessionInputRecord,
  RuntimeSessionPreparedExecution,
  RuntimeSessionRecord,
} from './session-types'
import type { PgExecutor } from './sql'
import { table } from './sql'

/** Create the normalized PostgreSQL Session transaction port. */
export function createPostgresSessionStore(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): PostgresSessionStore {
  const sessions = table(schema, 'sessions')
  const inputs = table(schema, 'session_inputs')
  const subscriptionMethods = createPostgresSessionSubscriptionMethods(
    db,
    schema,
    faults,
  )

  return {
    async create(input) {
      const now = input.now.toISOString()
      recordWrite(faults)
      const inserted = await db.query<Record<string, unknown>>(
        `INSERT INTO ${sessions}
          (namespace, session_id, key_hash, target_id, target_kind, thread_id,
           model, definition, state, accepted_cursor, pending_inputs,
           pending_work, blocked_work, statistics, wake_pending, created_at,
           updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'prepared',
                 0, 0, 0, 0, $9::jsonb, false, $10, $10)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          input.namespace,
          input.sessionId,
          input.keyHash,
          input.targetId,
          input.targetKind,
          input.threadId,
          input.model === undefined ? null : encodeJson(input.model),
          input.definition === undefined ? null : encodeJson(input.definition),
          encodeJson(initialSessionStatistics(input.sessionId, input.now)),
          now,
        ],
      )
      if (inserted.rows[0]) {
        return {
          kind: 'created',
          session: decodeSessionRecord(inserted.rows[0]),
        }
      }
      const existing = await getByKey(input.namespace, input.keyHash)
      if (!existing) throw new Error('Failed to read existing Runtime Session.')
      return existing.targetId === input.targetId
        ? { kind: 'existing', session: existing }
        : { kind: 'conflict', session: existing }
    },

    getByKey,

    async get(namespace, sessionId) {
      return await readSession(db, schema, namespace, sessionId)
    },

    async getInput(namespace, sessionId, inputId) {
      return await readSessionInput(db, schema, namespace, sessionId, inputId)
    },

    async getInputAtCursor(namespace, sessionId, cursor) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${inputs}
          WHERE namespace = $1 AND session_id = $2 AND cursor = $3`,
        [namespace, sessionId, cursor],
      )
      return result.rows[0] ? decodeSessionInputRecord(result.rows[0]) : null
    },

    async inspectInputs(namespace, sessionId, limit) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${inputs}
          WHERE namespace = $1 AND session_id = $2
          ORDER BY cursor DESC
          LIMIT $3`,
        [namespace, sessionId, limit + 1],
      )
      const truncated = result.rows.length > limit
      const selected = result.rows.slice(0, limit).reverse()
      return Object.freeze({
        inputs: Object.freeze(selected.map(decodeSessionInputRecord)),
        truncated,
      })
    },

    async markReady(namespace, sessionId, now) {
      const current = await readSession(db, schema, namespace, sessionId, true)
      if (!current) throw new Error(`Session "${sessionId}" was not found.`)
      if (current.state === 'ready') return current
      const ready: RuntimeSessionRecord = Object.freeze({
        ...current,
        state: 'ready',
        updatedAt: now.toISOString(),
      })
      return await writeSession(db, schema, faults, ready)
    },

    async acceptInputs(input) {
      if (input.inputs.length === 0) return Object.freeze([])
      const current = await readSession(
        db,
        schema,
        input.namespace,
        input.sessionId,
        true,
      )
      if (!current)
        throw new Error(`Session "${input.sessionId}" was not found.`)
      if (current.state !== 'ready') {
        throw new Error(`Session "${input.sessionId}" is not ready.`)
      }
      const acceptedAt = input.now.toISOString()
      const accepted: RuntimeSessionInputRecord[] = input.inputs.map(
        (value, index) =>
          Object.freeze({
            schemaVersion: 1,
            namespace: input.namespace,
            sessionId: input.sessionId,
            inputId: `input_${input.sessionId}_${current.acceptedCursor + index + 1}`,
            cursor: current.acceptedCursor + index + 1,
            input: value,
            acceptedAt,
          }),
      )
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${inputs}
          (namespace, session_id, input_id, cursor, input, accepted_at)
         SELECT $1, $2, value.input_id, value.cursor, value.input, value.accepted_at
           FROM jsonb_to_recordset($3::jsonb) AS value(
             input_id text, cursor bigint, input jsonb, accepted_at timestamptz
           )`,
        [
          input.namespace,
          input.sessionId,
          encodeJson(
            accepted.map((record) => ({
              input_id: record.inputId,
              cursor: record.cursor,
              input: record.input,
              accepted_at: record.acceptedAt,
            })),
          ),
        ],
      )
      await writeSession(
        db,
        schema,
        faults,
        Object.freeze({
          ...current,
          acceptedCursor: current.acceptedCursor + accepted.length,
          pendingInputs: current.pendingInputs + accepted.length,
          wakePending: true,
          updatedAt: acceptedAt,
        }),
      )
      return Object.freeze(accepted)
    },

    reserveTurn: async (input) =>
      await reserveSessionTurn(db, schema, faults, input),
    startTurn: async (input) =>
      await startSessionTurn(db, schema, faults, input),
    getTurnInputs: async (namespace, sessionId, workId) =>
      await listTurnInputs(db, schema, namespace, sessionId, workId),
    claimStepInputs: async (input) =>
      await claimSessionStepInputs(db, schema, faults, input),

    async getPreparedExecution(namespace, sessionId, inputId) {
      return (
        (await readSessionInput(db, schema, namespace, sessionId, inputId))
          ?.preparedExecution ?? null
      )
    },

    async checkpointPreparedExecution(input) {
      const prepared: RuntimeSessionPreparedExecution = Object.freeze({
        workId: input.workId,
        preparedResultRef: Object.freeze({ ...input.preparedResultRef }),
        checkpointedAt: input.now.toISOString(),
      })
      recordWrite(faults)
      await db.query(
        `UPDATE ${inputs}
            SET prepared_execution = $4::jsonb
          WHERE namespace = $1 AND session_id = $2
            AND work ->> 'workId' = $3
            AND (prepared_execution IS NULL OR prepared_execution = $4::jsonb)`,
        [input.namespace, input.sessionId, input.workId, encodeJson(prepared)],
      )
      const joined = await listTurnInputs(
        db,
        schema,
        input.namespace,
        input.sessionId,
        input.workId,
      )
      if (joined.length === 0) {
        throw new Error(`Session input "${input.inputId}" was not found.`)
      }
      for (const member of joined) {
        if (!member.preparedExecution) {
          throw new Error('Session execution checkpoint was not retained.')
        }
        assertSameCheckpoint(member.preparedExecution, prepared, member.inputId)
      }
      return decodePreparedExecution(prepared)
    },

    completeTurn: async (input) =>
      await settleSessionTurn(db, schema, faults, input, 'completed'),
    blockTurn: async (input) =>
      await settleSessionTurn(db, schema, faults, input, 'blocked'),

    async getByActivationWorkId(namespace, workId) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${sessions}
          WHERE namespace = $1 AND activation ->> 'workId' = $2`,
        [namespace, workId],
      )
      return result.rows[0] ? decodeSessionRecord(result.rows[0]) : null
    },

    ...subscriptionMethods,
  }

  async function getByKey(namespace: string, keyHash: string) {
    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM ${sessions} WHERE namespace = $1 AND key_hash = $2`,
      [namespace, keyHash],
    )
    return result.rows[0] ? decodeSessionRecord(result.rows[0]) : null
  }
}

function assertSameCheckpoint(
  existing: RuntimeSessionPreparedExecution,
  expected: RuntimeSessionPreparedExecution,
  inputId: string,
): void {
  if (
    existing.workId !== expected.workId ||
    existing.preparedResultRef.sha256 !== expected.preparedResultRef.sha256 ||
    existing.preparedResultRef.location !== expected.preparedResultRef.location
  ) {
    throw new Error(
      `Session input "${inputId}" has conflicting execution evidence.`,
    )
  }
}
