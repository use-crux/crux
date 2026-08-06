import {
  initialSessionStatistics,
  recordSessionStatistics,
} from '@use-crux/core/runtime/internal/session-store'
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import {
  closePostgresSession,
  deletePostgresSession,
  forkPostgresSession,
  killPostgresSession,
  listPostgresSessionForks,
} from './session-controls'
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
      if (existing.state === 'deleted') {
        return { kind: 'tombstone', session: existing }
      }
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
      if (current.state !== 'prepared') {
        throw new Error(
          `Session "${sessionId}" cannot become ready from state "${current.state}".`,
        )
      }
      const ready: RuntimeSessionRecord = Object.freeze({
        ...current,
        state: 'ready',
        updatedAt: now.toISOString(),
      })
      return await writeSession(db, schema, faults, ready)
    },

    async acceptInputs(input) {
      if (input.inputs.length === 0) return Object.freeze([])
      if (
        input.inputIds !== undefined &&
        input.inputIds.length !== input.inputs.length
      ) {
        throw new Error('Session inputIds must align with inputs.')
      }
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
        throw new Error(
          `Session "${input.sessionId}" no longer accepts external ingress.`,
        )
      }
      const acceptedAt = input.now.toISOString()
      // Idempotent for stable inputIds: ON CONFLICT DO NOTHING, then load
      // canonical rows. Cursor/pending advance only by newly inserted count.
      const planned: Array<{
        readonly inputId: string
        readonly input: unknown
        readonly isGenerated: boolean
      }> = input.inputs.map((value, index) => ({
        inputId:
          input.inputIds?.[index] ??
          `input_${input.sessionId}_${current.acceptedCursor + index + 1}`,
        input: value,
        isGenerated: input.inputIds?.[index] === undefined,
      }))

      // Preload existing stable ids so mixed batches assign cursors only to new rows.
      const existingById = new Map<string, RuntimeSessionInputRecord>()
      for (const item of planned) {
        if (item.isGenerated) continue
        const found = await readSessionInput(
          db,
          schema,
          input.namespace,
          input.sessionId,
          item.inputId,
        )
        if (found) existingById.set(item.inputId, found)
      }

      let nextCursor = current.acceptedCursor
      const toInsert: RuntimeSessionInputRecord[] = []
      const accepted: RuntimeSessionInputRecord[] = []
      for (const item of planned) {
        const existing = existingById.get(item.inputId)
        if (existing) {
          accepted.push(existing)
          continue
        }
        nextCursor += 1
        const record = Object.freeze({
          schemaVersion: 1 as const,
          namespace: input.namespace,
          sessionId: input.sessionId,
          inputId: item.inputId,
          cursor: nextCursor,
          input: item.input as RuntimeSessionInputRecord['input'],
          acceptedAt,
        })
        toInsert.push(record)
        accepted.push(record)
      }

      if (toInsert.length > 0) {
        recordWrite(faults)
        // ON CONFLICT DO NOTHING so concurrent primary-key races never abort.
        const insertResult = await db.query<{ input_id: string }>(
          `INSERT INTO ${inputs}
            (namespace, session_id, input_id, cursor, input, accepted_at)
           SELECT $1, $2, value.input_id, value.cursor, value.input, value.accepted_at
             FROM jsonb_to_recordset($3::jsonb) AS value(
               input_id text, cursor bigint, input jsonb, accepted_at timestamptz
             )
           ON CONFLICT (namespace, input_id) DO NOTHING
           RETURNING input_id`,
          [
            input.namespace,
            input.sessionId,
            encodeJson(
              toInsert.map((record) => ({
                input_id: record.inputId,
                cursor: record.cursor,
                input: record.input,
                accepted_at: record.acceptedAt,
              })),
            ),
          ],
        )
        const insertedIds = new Set(
          insertResult.rows.map((row) => row.input_id),
        )
        // Concurrent loser: reload canonical rows for conflicted ids and do not
        // advance cursor for them.
        const newlyInserted = toInsert.filter((record) =>
          insertedIds.has(record.inputId),
        )
        const conflicted = toInsert.filter(
          (record) => !insertedIds.has(record.inputId),
        )
        for (const record of conflicted) {
          const canonical = await readSessionInput(
            db,
            schema,
            input.namespace,
            input.sessionId,
            record.inputId,
          )
          if (!canonical) {
            throw new Error(
              `Session input "${record.inputId}" conflicted but was not found.`,
            )
          }
          const index = accepted.findIndex((row) => row.inputId === record.inputId)
          if (index >= 0) accepted[index] = canonical
        }
        const newCount = newlyInserted.length
        if (newCount > 0) {
          // Re-read session after inserts for accurate cursor under concurrency.
          const fresh = await readSession(
            db,
            schema,
            input.namespace,
            input.sessionId,
            true,
          )
          if (!fresh)
            throw new Error(`Session "${input.sessionId}" was not found.`)
          // Assign high-water from max of fresh cursor and inserted cursors.
          const maxInsertedCursor = Math.max(
            ...newlyInserted.map((row) => row.cursor),
            fresh.acceptedCursor,
          )
          await writeSession(
            db,
            schema,
            faults,
            Object.freeze({
              ...fresh,
              acceptedCursor: maxInsertedCursor,
              pendingInputs: fresh.pendingInputs + newCount,
              wakePending: true,
              updatedAt: acceptedAt,
            }),
          )
        }
        // Rebuild accepted order with canonical rows.
        for (let index = 0; index < accepted.length; index += 1) {
          const row = accepted[index]!
          if (insertedIds.has(row.inputId) || existingById.has(row.inputId)) {
            continue
          }
          const canonical = await readSessionInput(
            db,
            schema,
            input.namespace,
            input.sessionId,
            row.inputId,
          )
          if (canonical) accepted[index] = canonical
        }
      }
      return Object.freeze(accepted)
    },

    async appendStatistics(input) {
      const current = await readSession(
        db,
        schema,
        input.namespace,
        input.sessionId,
        true,
      )
      if (!current)
        throw new Error(`Session "${input.sessionId}" was not found.`)
      if (input.facts.length === 0) return current
      return await writeSession(
        db,
        schema,
        faults,
        Object.freeze({
          ...current,
          statistics: recordSessionStatistics(
            current.statistics,
            current.sessionId,
            input.now,
            input.facts,
          ),
          updatedAt: input.now.toISOString(),
        }),
      )
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
      const current = await readSession(
        db,
        schema,
        input.namespace,
        input.sessionId,
        true,
      )
      if (!current) {
        throw new Error(`Session "${input.sessionId}" was not found.`)
      }
      if (current.state !== 'ready' && current.state !== 'closing') {
        throw new Error(
          `Session "${input.sessionId}" no longer holds commit authority.`,
        )
      }
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

    close: async (input) =>
      await closePostgresSession(db, schema, faults, input),
    kill: async (input) => await killPostgresSession(db, schema, faults, input),
    delete: async (input) =>
      await deletePostgresSession(db, schema, faults, input),
    fork: async (input) => await forkPostgresSession(db, schema, faults, input),
    listForks: async (namespace, sessionId) =>
      await listPostgresSessionForks(db, schema, namespace, sessionId),
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
