import { v } from 'convex/values'
import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import { mutation } from '../_generated/server.js'
import { decodeCompositeValue, encodeCompositeValue } from '../../runtime-engine/codec'
import { createConvexSessionPort } from './session_port'

type SessionPort = NonNullable<RuntimeStoreTransaction['sessions']>
type SessionOperation = keyof SessionPort

/** Execute one Session port operation in a component-native mutation. */
export const run = mutation({
  args: { operation: v.string(), input: v.any() },
  returns: v.any(),
  handler: async (ctx, { operation, input }) =>
    encodeCompositeValue(await dispatch(createConvexSessionPort(ctx), assertOperation(operation), input)),
})

async function dispatch(port: SessionPort, operation: SessionOperation, encoded: unknown): Promise<unknown> {
  const input = decodeCompositeValue<readonly unknown[]>(encoded)
  switch (operation) {
    case 'create':
      return await port.create(decodeCompositeValue(encoded))
    case 'getByKey':
      return await port.getByKey(requiredString(input[0]), requiredString(input[1]))
    case 'get':
      return await port.get(requiredString(input[0]), requiredString(input[1]))
    case 'getInput':
      return await port.getInput(requiredString(input[0]), requiredString(input[1]), requiredString(input[2]))
    case 'getInputAtCursor':
      return await port.getInputAtCursor(requiredString(input[0]), requiredString(input[1]), requiredNumber(input[2]))
    case 'inspectInputs':
      return await port.inspectInputs(requiredString(input[0]), requiredString(input[1]), requiredNumber(input[2]))
    case 'markReady':
      return await port.markReady(requiredString(input[0]), requiredString(input[1]), requiredDate(input[2]))
    case 'acceptInputs':
      return await port.acceptInputs(decodeCompositeValue(encoded))
    case 'reserveTurn':
      return await port.reserveTurn(decodeCompositeValue(encoded))
    case 'startTurn':
      return await port.startTurn(decodeCompositeValue(encoded))
    case 'getTurnInputs':
      return await port.getTurnInputs(
        requiredString(input[0]),
        requiredString(input[1]),
        decodeCompositeValue<Parameters<SessionPort['getTurnInputs']>[2]>(input[2]),
      )
    case 'claimStepInputs':
      return await port.claimStepInputs(decodeCompositeValue(encoded))
    case 'getPreparedExecution':
      return await port.getPreparedExecution(
        requiredString(input[0]),
        requiredString(input[1]),
        requiredString(input[2]),
      )
    case 'checkpointPreparedExecution':
      return await port.checkpointPreparedExecution(decodeCompositeValue(encoded))
    case 'completeTurn':
      return await port.completeTurn(decodeCompositeValue(encoded))
    case 'blockTurn':
      return await port.blockTurn(decodeCompositeValue(encoded))
    case 'getByActivationWorkId':
      return await port.getByActivationWorkId(
        requiredString(input[0]),
        decodeCompositeValue(input[1]),
      )
    case 'upsertSubscription':
      return await port.upsertSubscription(decodeCompositeValue(encoded))
    case 'getSubscription':
      return await port.getSubscription(
        requiredString(input[0]),
        requiredString(input[1]),
        requiredString(input[2]),
      )
    case 'listSubscriptions':
      return await port.listSubscriptions(
        requiredString(input[0]),
        requiredString(input[1]),
      )
    case 'listActiveSubscriptionsForSignal':
      return await port.listActiveSubscriptionsForSignal(
        requiredString(input[0]),
        requiredString(input[1]),
      )
    case 'unsubscribe':
      return await port.unsubscribe(
        requiredString(input[0]),
        requiredString(input[1]),
        requiredString(input[2]),
        requiredDate(input[3]),
      )
    case 'close':
      return await port.close?.(decodeCompositeValue(encoded))
    case 'kill':
      return await port.kill?.(decodeCompositeValue(encoded))
    case 'delete':
      return await port.delete?.(decodeCompositeValue(encoded))
    case 'fork':
      return await port.fork?.(decodeCompositeValue(encoded))
    case 'listForks':
      return await port.listForks?.(
        requiredString(input[0]),
        requiredString(input[1]),
      )
  }
}

function assertOperation(value: string): SessionOperation {
  switch (value) {
    case 'create':
    case 'getByKey':
    case 'get':
    case 'getInput':
    case 'getInputAtCursor':
    case 'inspectInputs':
    case 'markReady':
    case 'acceptInputs':
    case 'reserveTurn':
    case 'startTurn':
    case 'getTurnInputs':
    case 'claimStepInputs':
    case 'getPreparedExecution':
    case 'checkpointPreparedExecution':
    case 'completeTurn':
    case 'blockTurn':
    case 'getByActivationWorkId':
    case 'upsertSubscription':
    case 'getSubscription':
    case 'listSubscriptions':
    case 'listActiveSubscriptionsForSignal':
    case 'unsubscribe':
    case 'close':
    case 'kill':
    case 'delete':
    case 'fork':
    case 'listForks':
      return value
    default:
      throw new Error(`Unknown Runtime Session operation "${value}".`)
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected Session string argument.')
  return value
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number') throw new TypeError('Expected Session number argument.')
  return value
}

function requiredDate(value: unknown): Date {
  if (!(value instanceof Date)) throw new TypeError('Expected Session Date argument.')
  return value
}
