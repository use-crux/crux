import { recordSessionStatistics } from '@use-crux/core/runtime/internal/session-store'
import type { MutationCtx } from '../_generated/server.js'
import {
  readSession,
  replaceSession,
  sessionInputDocument,
  sessionInputRecord,
  sessionRecord,
  sessionInputs,
  workInputs,
  type SessionInputRecord,
  type SessionPort,
} from './session_helpers'

type TurnInput = Parameters<SessionPort['startTurn']>[0]
type StepInput = Parameters<SessionPort['claimStepInputs']>[0]

/** Link the complete cursor-consecutive prefix to one leased Work. */
export async function startSessionTurn(ctx: MutationCtx, input: TurnInput) {
  const row = await requiredSession(ctx, input.namespace, input.sessionId)
  const activation = row.activation
  if (!activation || activation.primaryInputId !== input.inputId) return null
  if (activation.state === 'running') {
    return {
      activation,
      inputs: await readWorkInputs(ctx, input.namespace, input.sessionId, activation.workId),
    }
  }
  const rows = await sessionInputs(ctx, input.namespace, input.sessionId)
  const candidates = consecutiveUnlinked(rows, (row.processedCursor ?? 0) + 1, row.acceptedCursor)
  if (candidates[0]?.inputId !== input.inputId) return null
  const running = { ...activation, state: 'running' as const }
  const linked: SessionInputRecord[] = []
  for (const candidate of candidates) {
    const work = {
      workId: activation.workId,
      target: activation.target,
      state: 'running' as const,
    }
    const next: SessionInputRecord = { ...sessionInputRecord(candidate), work }
    await ctx.db.replace(candidate._id, sessionInputDocument(next))
    linked.push(next)
  }
  await replaceSession(ctx, row, {
    ...sessionRecord(row),
    activation: running,
    statistics: recordSessionStatistics(row.statistics, row.sessionId, input.now, [
      {
        kind: 'work-state',
        target: activation.target,
        from: 'queued',
        to: 'running',
      },
    ]),
    updatedAt: input.now.toISOString(),
  })
  return { activation: running, inputs: linked }
}

export async function getSessionTurnInputs(ctx: MutationCtx, namespace: string, sessionId: string, workId: string) {
  return await readWorkInputs(ctx, namespace, sessionId, workId)
}

/** Claim previously linked and newly accepted input at one semantic boundary. */
export async function claimSessionStepInputs(ctx: MutationCtx, input: StepInput) {
  const row = await requiredSession(ctx, input.namespace, input.sessionId)
  const activation = row.activation
  if (!activation || activation.workId !== input.workId || activation.state !== 'running') {
    throw new Error(`Session activation "${input.workId}" is not running.`)
  }
  const linkedRows = await workInputs(ctx, input.namespace, input.sessionId, input.workId)
  const allRows = await sessionInputs(ctx, input.namespace, input.sessionId)
  const lastCursor = linkedRows.at(-1)?.cursor ?? row.processedCursor ?? 0
  const newlyClaimed = consecutiveUnlinked(allRows, lastCursor + 1, row.acceptedCursor)
  const deliveredAt = input.now.toISOString()
  for (const candidate of [...linkedRows, ...newlyClaimed]) {
    if (candidate.delivery) continue
    const work = candidate.work ?? {
      workId: activation.workId,
      target: activation.target,
      state: 'running' as const,
    }
    await ctx.db.replace(
      candidate._id,
      sessionInputDocument({
        ...sessionInputRecord(candidate),
        work,
        delivery: {
          stepIndex: input.stepIndex,
          reason: input.reason,
          deliveredAt,
        },
      }),
    )
  }
  const replayable = (await workInputs(ctx, input.namespace, input.sessionId, input.workId))
    .filter(
      (candidate) => candidate.delivery?.stepIndex === input.stepIndex && candidate.delivery.reason === input.reason,
    )
    .map(sessionInputRecord)
  return { acceptedCursor: row.acceptedCursor, inputs: replayable }
}

async function requiredSession(ctx: MutationCtx, namespace: string, sessionId: string) {
  const row = await readSession(ctx, namespace, sessionId)
  if (!row) throw new Error(`Session "${sessionId}" was not found.`)
  return row
}

async function readWorkInputs(ctx: MutationCtx, namespace: string, sessionId: string, workId: string) {
  return (await workInputs(ctx, namespace, sessionId, workId)).map(sessionInputRecord)
}

function consecutiveUnlinked<T extends { cursor: number; work?: unknown }>(
  rows: readonly T[],
  firstCursor: number,
  acceptedCursor: number,
): readonly T[] {
  const byCursor = new Map(rows.map((row) => [row.cursor, row]))
  const result: T[] = []
  for (let cursor = firstCursor; cursor <= acceptedCursor; cursor += 1) {
    const row = byCursor.get(cursor)
    if (!row || row.work) break
    result.push(row)
  }
  return result
}
