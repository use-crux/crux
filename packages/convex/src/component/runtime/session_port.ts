import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import {
  acceptSessionInputs,
  createSession,
  getSession,
  getSessionByKey,
  getSessionInput,
  getSessionInputAtCursor,
  inspectSessionInputs,
  markSessionReady,
  reserveSessionTurn,
} from './session_identity'
import { claimSessionStepInputs, getSessionTurnInputs, startSessionTurn } from './session_execution'
import {
  blockSessionTurn,
  checkpointSessionExecution,
  completeSessionTurn,
  getSessionPreparedExecution,
} from './session_checkpoint'

/** Build the Convex-local Session port for one atomic component mutation. */
export function createConvexSessionPort(ctx: MutationCtx): NonNullable<RuntimeStoreTransaction['sessions']> {
  return {
    create: (input) => createSession(ctx, input),
    getByKey: (namespace, keyHash) => getSessionByKey(ctx, namespace, keyHash),
    get: (namespace, sessionId) => getSession(ctx, namespace, sessionId),
    getInput: (namespace, sessionId, inputId) => getSessionInput(ctx, namespace, sessionId, inputId),
    getInputAtCursor: (namespace, sessionId, cursor) => getSessionInputAtCursor(ctx, namespace, sessionId, cursor),
    inspectInputs: (namespace, sessionId, limit) => inspectSessionInputs(ctx, namespace, sessionId, limit),
    markReady: (namespace, sessionId, now) => markSessionReady(ctx, namespace, sessionId, now),
    acceptInputs: (input) => acceptSessionInputs(ctx, input),
    reserveTurn: (input) => reserveSessionTurn(ctx, input),
    startTurn: (input) => startSessionTurn(ctx, input),
    getTurnInputs: (namespace, sessionId, workId) => getSessionTurnInputs(ctx, namespace, sessionId, workId),
    claimStepInputs: (input) => claimSessionStepInputs(ctx, input),
    getPreparedExecution: (namespace, sessionId, inputId) =>
      getSessionPreparedExecution(ctx, namespace, sessionId, inputId),
    checkpointPreparedExecution: (input) => checkpointSessionExecution(ctx, input),
    completeTurn: (input) => completeSessionTurn(ctx, input),
    blockTurn: (input) => blockSessionTurn(ctx, input),
  }
}
