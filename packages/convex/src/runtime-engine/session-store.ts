import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import { decodeCompositeValue, encodeCompositeValue } from './codec'

type SessionPort = NonNullable<RuntimeStoreTransaction['sessions']>

interface ConvexSessionStoreOptions {
  readonly ref: unknown
  readonly run: <TResult>(ref: unknown, args: Record<string, unknown>) => Promise<TResult>
}

/** Bind Core's Session port to the component's atomic mutation dispatcher. */
export function createConvexSessionStore(options: ConvexSessionStoreOptions): SessionPort {
  const call = async <TResult>(operation: keyof SessionPort, input: unknown): Promise<TResult> =>
    decodeCompositeValue<TResult>(
      await options.run(options.ref, {
        operation,
        input: encodeCompositeValue(input),
      }),
    )
  return {
    create: (input) => call('create', input),
    getByKey: (namespace, keyHash) => call('getByKey', [namespace, keyHash]),
    get: (namespace, sessionId) => call('get', [namespace, sessionId]),
    getInput: (namespace, sessionId, inputId) => call('getInput', [namespace, sessionId, inputId]),
    getInputAtCursor: (namespace, sessionId, cursor) => call('getInputAtCursor', [namespace, sessionId, cursor]),
    inspectInputs: (namespace, sessionId, limit) => call('inspectInputs', [namespace, sessionId, limit]),
    markReady: (namespace, sessionId, now) => call('markReady', [namespace, sessionId, now]),
    acceptInputs: (input) => call('acceptInputs', input),
    reserveTurn: (input) => call('reserveTurn', input),
    startTurn: (input) => call('startTurn', input),
    getTurnInputs: (namespace, sessionId, workId) => call('getTurnInputs', [namespace, sessionId, workId]),
    claimStepInputs: (input) => call('claimStepInputs', input),
    getPreparedExecution: (namespace, sessionId, inputId) =>
      call('getPreparedExecution', [namespace, sessionId, inputId]),
    checkpointPreparedExecution: (input) => call('checkpointPreparedExecution', input),
    completeTurn: (input) => call('completeTurn', input),
    blockTurn: (input) => call('blockTurn', input),
    getByActivationWorkId: (namespace, workId) =>
      call('getByActivationWorkId', [namespace, workId]),
    upsertSubscription: (input) => call('upsertSubscription', input),
    getSubscription: (namespace, sessionId, subscriptionId) =>
      call('getSubscription', [namespace, sessionId, subscriptionId]),
    listSubscriptions: (namespace, sessionId) =>
      call('listSubscriptions', [namespace, sessionId]),
    listActiveSubscriptionsForSignal: (namespace, signalId) =>
      call('listActiveSubscriptionsForSignal', [namespace, signalId]),
    unsubscribe: (namespace, sessionId, subscriptionId, now) =>
      call('unsubscribe', [namespace, sessionId, subscriptionId, now]),
  }
}
