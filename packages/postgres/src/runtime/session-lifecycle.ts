import { recordSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import {
  listSessionInputs,
  listTurnInputs,
  readSession,
  readSessionInput,
  writeSession,
} from './session-records'
import type {
  PostgresSessionStore,
  RuntimeSessionActivation,
  RuntimeSessionInputRecord,
} from './session-types'
import type { PgExecutor } from './sql'
import { table } from './sql'

type ReserveInput = Parameters<PostgresSessionStore['reserveTurn']>[0]
type TurnInput = Parameters<PostgresSessionStore['startTurn']>[0]
type StepInput = Parameters<PostgresSessionStore['claimStepInputs']>[0]

export async function reserveSessionTurn(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: ReserveInput,
) {
  const session = await requiredSession(db, schema, input, true)
  if (session.activation) return session.activation
  await requiredInput(db, schema, input)
  const activation: RuntimeSessionActivation = Object.freeze({
    workId: input.workId,
    primaryInputId: input.inputId,
    target: input.target,
    state: 'queued',
  })
  const updated = Object.freeze({
    ...session,
    activation,
    pendingWork: session.pendingWork + 1,
    statistics: recordSessionStatistics(
      session.statistics,
      session.sessionId,
      input.now,
      [{ kind: 'work-accepted', target: input.target, state: 'queued' }],
    ),
    wakePending: true,
    updatedAt: input.now.toISOString(),
  })
  await writeSession(db, schema, faults, updated)
  return activation
}

export async function startSessionTurn(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: TurnInput,
) {
  const session = await requiredSession(db, schema, input, true)
  const activation = session.activation
  if (!activation || activation.primaryInputId !== input.inputId) return null
  if (activation.state === 'running') {
    return Object.freeze({
      activation,
      inputs: await listTurnInputs(
        db,
        schema,
        input.namespace,
        input.sessionId,
        activation.workId,
      ),
    })
  }
  const candidates = await listSessionInputs(
    db,
    schema,
    input.namespace,
    input.sessionId,
    session.processedCursor ?? 0,
  )
  const inputs = consecutiveUnlinked(
    candidates,
    (session.processedCursor ?? 0) + 1,
  )
  if (inputs[0]?.inputId !== input.inputId) return null
  const work: NonNullable<RuntimeSessionInputRecord['work']> = Object.freeze({
    workId: activation.workId,
    target: activation.target,
    state: 'running',
  })
  recordWrite(faults)
  await db.query(
    `UPDATE ${table(schema, 'session_inputs')}
        SET work = $4::jsonb
      WHERE namespace = $1 AND session_id = $2 AND input_id = ANY($3::text[])`,
    [
      input.namespace,
      input.sessionId,
      inputs.map((member) => member.inputId),
      encodeJson(work),
    ],
  )
  const running: RuntimeSessionActivation = Object.freeze({
    ...activation,
    state: 'running',
  })
  await writeSession(
    db,
    schema,
    faults,
    Object.freeze({
      ...session,
      activation: running,
      statistics: recordSessionStatistics(
        session.statistics,
        session.sessionId,
        input.now,
        [
          {
            kind: 'work-state',
            target: activation.target,
            from: 'queued',
            to: 'running',
          },
        ],
      ),
      updatedAt: input.now.toISOString(),
    }),
  )
  return Object.freeze({
    activation: running,
    inputs: Object.freeze(
      inputs.map((member) => Object.freeze({ ...member, work })),
    ),
  })
}

export async function claimSessionStepInputs(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: StepInput,
) {
  const session = await requiredSession(db, schema, input, true)
  const activation = session.activation
  if (
    !activation ||
    activation.workId !== input.workId ||
    activation.state !== 'running'
  ) {
    throw new Error(`Session activation "${input.workId}" is not running.`)
  }
  const linked = await listTurnInputs(
    db,
    schema,
    input.namespace,
    input.sessionId,
    input.workId,
  )
  const lastCursor = linked.at(-1)?.cursor ?? session.processedCursor ?? 0
  const unlinked = consecutiveUnlinked(
    await listSessionInputs(
      db,
      schema,
      input.namespace,
      input.sessionId,
      lastCursor,
    ),
    lastCursor + 1,
  )
  const candidates = [...linked, ...unlinked].filter(
    (member) => !member.delivery,
  )
  if (candidates.length > 0) {
    const work: NonNullable<RuntimeSessionInputRecord['work']> = Object.freeze({
      workId: activation.workId,
      target: activation.target,
      state: 'running',
    })
    const delivery = Object.freeze({
      stepIndex: input.stepIndex,
      reason: input.reason,
      deliveredAt: input.now.toISOString(),
    })
    recordWrite(faults)
    await db.query(
      `UPDATE ${table(schema, 'session_inputs')}
          SET work = COALESCE(work, $4::jsonb), delivery = $5::jsonb
        WHERE namespace = $1 AND session_id = $2
          AND input_id = ANY($3::text[]) AND delivery IS NULL`,
      [
        input.namespace,
        input.sessionId,
        candidates.map((member) => member.inputId),
        encodeJson(work),
        encodeJson(delivery),
      ],
    )
  }
  const replayable = (
    await listTurnInputs(
      db,
      schema,
      input.namespace,
      input.sessionId,
      input.workId,
    )
  ).filter(
    (member) =>
      member.delivery?.stepIndex === input.stepIndex &&
      member.delivery.reason === input.reason,
  )
  return Object.freeze({
    acceptedCursor: session.acceptedCursor,
    inputs: Object.freeze(replayable),
  })
}

function consecutiveUnlinked(
  candidates: readonly RuntimeSessionInputRecord[],
  firstCursor: number,
): readonly RuntimeSessionInputRecord[] {
  const claimed: RuntimeSessionInputRecord[] = []
  let cursor = firstCursor
  for (const candidate of candidates) {
    if (candidate.cursor !== cursor || candidate.work) break
    claimed.push(candidate)
    cursor += 1
  }
  return claimed
}

async function requiredSession(
  db: PgExecutor,
  schema: string,
  input: { readonly namespace: string; readonly sessionId: string },
  lock: boolean,
) {
  const session = await readSession(
    db,
    schema,
    input.namespace,
    input.sessionId,
    lock,
  )
  if (!session) throw new Error(`Session "${input.sessionId}" was not found.`)
  return session
}

async function requiredInput(
  db: PgExecutor,
  schema: string,
  input: {
    readonly namespace: string
    readonly sessionId: string
    readonly inputId: string
  },
) {
  const accepted = await readSessionInput(
    db,
    schema,
    input.namespace,
    input.sessionId,
    input.inputId,
  )
  if (!accepted)
    throw new Error(`Session input "${input.inputId}" was not found.`)
  return accepted
}
