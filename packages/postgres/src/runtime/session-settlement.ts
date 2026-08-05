import { recordSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import {
  maybeFinalizeClosingSession,
  sessionAcceptsWorkMutation,
} from './session-controls'
import {
  listTurnInputs,
  readSession,
  readSessionInput,
  writeSession,
} from './session-records'
import type { PostgresSessionStore } from './session-types'
import type { PgExecutor } from './sql'
import { table } from './sql'

type TurnInput = Parameters<PostgresSessionStore['completeTurn']>[0]

export async function settleSessionTurn(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
  input: TurnInput,
  outcome: 'completed' | 'blocked',
) {
  const session = await readSession(
    db,
    schema,
    input.namespace,
    input.sessionId,
    true,
  )
  if (!session) throw new Error(`Session "${input.sessionId}" was not found.`)
  if (!sessionAcceptsWorkMutation(session)) return session
  const accepted = await readSessionInput(
    db,
    schema,
    input.namespace,
    input.sessionId,
    input.inputId,
  )
  if (!accepted)
    throw new Error(`Session input "${input.inputId}" was not found.`)
  const work = accepted.work
  if (!work) throw new Error(`Session input "${input.inputId}" has no Work.`)
  if (work.state === 'completed' || work.state === 'blocked') return session
  const joined = await listTurnInputs(
    db,
    schema,
    input.namespace,
    input.sessionId,
    work.workId,
  )
  if (joined.length === 0 || joined.some((member) => !member.work)) {
    throw new Error('Session activation linkage is incomplete.')
  }
  recordWrite(faults)
  await db.query(
    `UPDATE ${table(schema, 'session_inputs')}
        SET work = jsonb_set(work, '{state}', to_jsonb($4::text))
      WHERE namespace = $1 AND session_id = $2 AND input_id = ANY($3::text[])`,
    [
      input.namespace,
      input.sessionId,
      joined.map((member) => member.inputId),
      outcome,
    ],
  )
  const processedCursor = Math.max(...joined.map((member) => member.cursor))
  const statistics = recordSessionStatistics(
    session.statistics,
    session.sessionId,
    input.now,
    outcome === 'completed'
      ? [
          {
            kind: 'work-outcome',
            target: work.target,
            from: work.state,
            outcome,
          },
        ]
      : [
          {
            kind: 'work-state',
            target: work.target,
            from: work.state,
            to: outcome,
          },
        ],
  )
  return await writeSession(
    db,
    schema,
    faults,
    maybeFinalizeClosingSession(
      Object.freeze({
        ...session,
        ...(outcome === 'completed' ? { processedCursor } : {}),
        pendingInputs: session.pendingInputs - joined.length,
        pendingWork:
          outcome === 'completed'
            ? session.pendingWork - 1
            : session.pendingWork,
        blockedWork:
          outcome === 'blocked' ? session.blockedWork + 1 : session.blockedWork,
        statistics,
        activation: outcome === 'completed' ? undefined : session.activation,
        wakePending: session.acceptedCursor > processedCursor,
        updatedAt: input.now.toISOString(),
      }),
      input.now,
    ),
  )
}
