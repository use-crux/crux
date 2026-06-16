import type { ConvexAgentContextMessage, ConvexAgentContextSnapshot, ConvexAgentThreadSession } from './driver'
import type {
  ConvexAgentPrepareMessages,
  ConvexAgentThreadTarget,
  ConvexAgentOperation,
  CruxConvexThread,
  PreparedAgentCall,
} from './lifecycle-types'
import { afterPreparedAgentCall } from './lifecycle-persistence'
import { isFinishCallback, isRecord } from './lifecycle-utils'

interface PreparedThreadCall {
  readonly ctx: unknown
  readonly target: ConvexAgentThreadTarget
  readonly prepared: PreparedAgentCall
  readonly options: Record<string, unknown> | undefined
}

interface PreparedThreadCallHandler<R> {
  (call: PreparedThreadCall): Promise<R>
  readonly operation: Exclude<ConvexAgentOperation, 'resolve'>
}

interface ThreadPrepareState {
  run<R>(
    callArgs: Record<string, unknown>,
    options: Record<string, unknown> | undefined,
    fn: PreparedThreadCallHandler<R>,
  ): Promise<R>
}

/** Wrap a Convex Agent thread with Crux prompt resolution for each turn. */
export function wrapCruxConvexThread(thread: ConvexAgentThreadSession, state: ThreadPrepareState): CruxConvexThread {
  return {
    threadId: thread.threadId,
    getMetadata: () => thread.getMetadata(),
    updateMetadata: (patch) => thread.updateMetadata(patch),
    generateText: async (args = {}, options) => {
      const handler: PreparedThreadCallHandler<unknown> = Object.assign(
        async (call: PreparedThreadCall) => {
          const result = await call.prepared.session.generateText(
            call.ctx,
            call.target,
            call.prepared.callArgs,
            call.options,
          )
          await afterPreparedAgentCall({
            resolved: call.prepared.resolved,
            input: call.prepared.input,
            result,
            captureMessages: call.prepared.captureMessages,
          })
          return result
        },
        { operation: 'generateText' as const },
      )
      return await state.run(args, options, handler)
    },
    streamText: async (args = {}, options) => {
      const handler: PreparedThreadCallHandler<unknown> = Object.assign(
        async (call: PreparedThreadCall) => {
          const userOnFinish = isFinishCallback(call.prepared.callArgs.onFinish)
            ? call.prepared.callArgs.onFinish
            : undefined
          call.prepared.callArgs.onFinish = async (result: unknown) => {
            await afterPreparedAgentCall({
              resolved: call.prepared.resolved,
              input: call.prepared.input,
              result,
              captureMessages: call.prepared.captureMessages,
            })
            if (userOnFinish) return await userOnFinish(result)
            return undefined
          }
          return await call.prepared.session.streamText(call.ctx, call.target, call.prepared.callArgs, call.options)
        },
        { operation: 'streamText' as const },
      )
      return await state.run(args, options, handler)
    },
  }
}

/** Merge per-thread call args with Crux-resolved args, keeping resolved tools authoritative. */
export function withThreadCallArgs(prepared: PreparedAgentCall, callArgs: Record<string, unknown>): PreparedAgentCall {
  return {
    ...prepared,
    callArgs: {
      ...callArgs,
      ...prepared.callArgs,
      tools: prepared.convexTools,
    },
  }
}

/** Convert a context snapshot into the public prepare message shape. */
export function prepareMessagesFromSnapshot(snapshot: ConvexAgentContextSnapshot): ConvexAgentPrepareMessages {
  return {
    all: snapshot.all,
    search: snapshot.search,
    recent: snapshot.recent,
    inputMessages: snapshot.inputMessages,
    inputPrompt: snapshot.inputPrompt,
    existingResponses: snapshot.existingResponses,
  }
}

/** Update the target from the thread context Convex Agent actually found. */
export function targetFromContextSnapshot(
  target: ConvexAgentThreadTarget,
  snapshot: ConvexAgentContextSnapshot,
): ConvexAgentThreadTarget {
  return {
    ...target,
    threadId: snapshot.threadId ?? target.threadId,
    userId: snapshot.userId ?? target.userId,
  }
}

/** Build options that replay the already-inspected Convex Agent context. */
export function withThreadContextOptions(
  options: Record<string, unknown> | undefined,
  snapshot: ConvexAgentContextSnapshot,
  callArgs: Record<string, unknown>,
): Record<string, unknown> {
  const preparedContext = preparedThreadContext(snapshot, callArgs)
  return {
    ...(options ?? {}),
    contextHandler: async () => preparedContext.all,
  }
}

function preparedThreadContext(
  snapshot: ConvexAgentContextSnapshot,
  callArgs: Record<string, unknown>,
): ConvexAgentContextSnapshot {
  const messagesOverride = messageListOverride(callArgs.messages)
  const promptOverride = promptMessageOverride(callArgs.prompt)
  const inputMessages = messagesOverride.present ? messagesOverride.messages : snapshot.inputMessages
  const inputPrompt = promptOverride.present ? promptOverride.messages : snapshot.inputPrompt
  return {
    ...snapshot,
    inputMessages,
    inputPrompt,
    all: [...snapshot.search, ...snapshot.recent, ...inputMessages, ...inputPrompt, ...snapshot.existingResponses],
  }
}

function messageListOverride(value: unknown): { present: boolean; messages: ConvexAgentContextMessage[] } {
  return {
    present: Array.isArray(value),
    messages: modelMessagesFromUnknown(value),
  }
}

function promptMessageOverride(value: unknown): { present: boolean; messages: ConvexAgentContextMessage[] } {
  if (typeof value === 'string') {
    return {
      present: true,
      messages: value.length > 0 ? [{ role: 'user', content: value }] : [],
    }
  }
  return {
    present: Array.isArray(value),
    messages: modelMessagesFromUnknown(value),
  }
}

function modelMessagesFromUnknown(value: unknown): ConvexAgentContextMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter(isConvexModelMessage)
}

function isConvexModelMessage(value: unknown): value is ConvexAgentContextMessage {
  return isRecord(value) && isConvexModelRole(value.role)
}

function isConvexModelRole(value: unknown): value is ConvexAgentContextMessage['role'] {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool'
}
