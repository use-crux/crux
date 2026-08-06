import { recordSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import type { MutationCtx } from '../_generated/server.js'
import {
  maybeFinalizeClosingSession,
  sessionAcceptsWorkMutation,
} from './session_controls'
import {
  readInput,
  readSession,
  replaceSession,
  sessionInputDocument,
  sessionInputRecord,
  sessionRecord,
  workInputs,
  type SessionInputRecord,
  type SessionPort,
  type SessionRecord,
} from './session_helpers'

type TurnInput = Parameters<SessionPort['startTurn']>[0]
type CheckpointInput = Parameters<SessionPort['checkpointPreparedExecution']>[0]

export async function getSessionPreparedExecution(
  ctx: MutationCtx,
  namespace: string,
  sessionId: string,
  inputId: string,
) {
  const row = await readInput(ctx, namespace, sessionId, inputId)
  return row?.preparedExecution ?? null
}

/** Retain one prepared artifact reference for every joined input. */
export async function checkpointSessionExecution(ctx: MutationCtx, input: CheckpointInput) {
  const sessionRow = await readSession(ctx, input.namespace, input.sessionId)
  if (!sessionRow) throw new Error(`Session "${input.sessionId}" was not found.`)
  if (!sessionAcceptsWorkMutation(sessionRecord(sessionRow))) {
    throw new Error(
      `Session "${input.sessionId}" no longer holds commit authority.`,
    )
  }
  const accepted = await readInput(ctx, input.namespace, input.sessionId, input.inputId)
  if (!accepted) throw new Error(`Session input "${input.inputId}" was not found.`)
  const prepared = {
    workId: input.workId,
    preparedResultRef: { ...input.preparedResultRef },
    checkpointedAt: input.now.toISOString(),
  }
  const joined = await workInputs(ctx, input.namespace, input.sessionId, input.workId)
  for (const member of joined) {
    if (member.preparedExecution) {
      assertSameCheckpoint(member.preparedExecution, input)
      continue
    }
    await ctx.db.replace(
      member._id,
      sessionInputDocument({
        ...sessionInputRecord(member),
        preparedExecution: prepared,
      }),
    )
  }
  return prepared
}

export async function completeSessionTurn(ctx: MutationCtx, input: TurnInput) {
  return await settleSessionTurn(ctx, input, 'completed')
}

export async function blockSessionTurn(ctx: MutationCtx, input: TurnInput) {
  return await settleSessionTurn(ctx, input, 'blocked')
}

async function settleSessionTurn(ctx: MutationCtx, input: TurnInput, outcome: 'completed' | 'blocked') {
  const accepted = await readInput(ctx, input.namespace, input.sessionId, input.inputId)
  if (!accepted) throw new Error(`Session input "${input.inputId}" was not found.`)
  const work = accepted.work
  if (!work) throw new Error(`Session input "${input.inputId}" has no Work.`)
  const row = await readSession(ctx, input.namespace, input.sessionId)
  if (!row) throw new Error(`Session "${input.sessionId}" was not found.`)
  const current = sessionRecord(row)
  if (!sessionAcceptsWorkMutation(current)) return current
  if (work.state === 'completed' || work.state === 'blocked') return current
  const joined = await workInputs(ctx, input.namespace, input.sessionId, work.workId)
  for (const member of joined) {
    if (!member.work) throw new Error('Session activation linkage is incomplete.')
    await ctx.db.replace(
      member._id,
      sessionInputDocument({
        ...sessionInputRecord(member),
        work: { ...member.work, state: outcome },
      }),
    )
  }
  const processedCursor = Math.max(...joined.map((member) => member.cursor))
  const settled: SessionRecord = {
    ...current,
    ...(outcome === 'completed' ? { processedCursor } : {}),
    pendingInputs: row.pendingInputs - joined.length,
    pendingWork: outcome === 'completed' ? row.pendingWork - 1 : row.pendingWork,
    blockedWork: outcome === 'blocked' ? row.blockedWork + 1 : row.blockedWork,
    statistics: recordSessionStatistics(
      row.statistics,
      row.sessionId,
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
    ),
    ...(outcome === 'completed' ? { activation: undefined } : { activation: row.activation }),
    wakePending: row.acceptedCursor > processedCursor,
    updatedAt: input.now.toISOString(),
  }
  const next = maybeFinalizeClosingSession(settled, input.now)
  return await replaceSession(
    ctx,
    row,
    next,
    outcome === 'completed' || next.activation === undefined
      ? { activationWorkId: null }
      : undefined,
  )
}

function assertSameCheckpoint(
  existing: NonNullable<SessionInputRecord['preparedExecution']>,
  input: CheckpointInput,
): void {
  if (
    existing.workId !== input.workId ||
    existing.preparedResultRef.sha256 !== input.preparedResultRef.sha256 ||
    existing.preparedResultRef.location !== input.preparedResultRef.location
  ) {
    throw new Error(`Session input "${input.inputId}" has conflicting execution evidence.`)
  }
}
