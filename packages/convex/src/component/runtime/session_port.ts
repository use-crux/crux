import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import {
  acceptSessionInputs,
  createSession,
  getSession,
  getSessionByActivationWorkId,
  getSessionByKey,
  getSessionInput,
  getSessionInputAtCursor,
  inspectSessionInputs,
  markSessionReady,
  reserveSessionTurn,
} from './session_identity'
import {
  getSessionSubscription,
  listActiveSubscriptionsForSignal,
  listSessionSubscriptions,
  unsubscribeSessionSubscription,
  upsertSessionSubscription,
} from './session_subscriptions'
import { claimSessionStepInputs, getSessionTurnInputs, startSessionTurn } from './session_execution'
import {
  blockSessionTurn,
  checkpointSessionExecution,
  completeSessionTurn,
  getSessionPreparedExecution,
} from './session_checkpoint'
import {
  closeSession,
  deleteSession,
  forkSession,
  killSession,
  listSessionForks,
} from './session_controls'

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
    getByActivationWorkId: (namespace, workId) =>
      getSessionByActivationWorkId(ctx, namespace, workId),
    upsertSubscription: (input) => upsertSessionSubscription(ctx, input),
    getSubscription: (namespace, sessionId, subscriptionId) =>
      getSessionSubscription(ctx, namespace, sessionId, subscriptionId),
    listSubscriptions: (namespace, sessionId) =>
      listSessionSubscriptions(ctx, namespace, sessionId),
    listActiveSubscriptionsForSignal: (namespace, signalId) =>
      listActiveSubscriptionsForSignal(ctx, namespace, signalId),
    unsubscribe: (namespace, sessionId, subscriptionId, now) =>
      unsubscribeSessionSubscription(ctx, namespace, sessionId, subscriptionId, now),
    close: (input) => closeSession(ctx, input),
    kill: (input) => killSession(ctx, input),
    delete: (input) => deleteSession(ctx, input),
    fork: (input) => forkSession(ctx, input),
    listForks: (namespace, sessionId) => listSessionForks(ctx, namespace, sessionId),
  }
}
