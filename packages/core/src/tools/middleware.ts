/**
 * SDK-agnostic tool middleware.
 *
 * {@link toolMiddleware} wraps a tool's `execute` with before/around/after/error
 * hooks; {@link approvalMiddleware} layers human-in-the-loop approval onto matched
 * tools. {@link applyToolMiddleware} composes a middleware chain across a tool set,
 * and {@link notifyToolApprovalResponses} fires approval callbacks from resumed
 * message history.
 *
 * The approval bookkeeping (`approvalMetadata`, `handledApprovals`) is intentionally
 * module-level so a single process shares one approval registry across these
 * functions.
 *
 * @module
 */

import { getHooks } from '../runtime/runtime'
import { getExecutionContext } from '../runtime/execution-context'
import type { DefinitionRef } from '../observability/contract'
import { collectToolApprovals } from './internal/message-parsing'
import {
  approvalDecisionKey,
  assertNonEmptyId,
  createToolCallId,
  isToolLike,
  matchesAny,
} from './internal/middleware-helpers'
import type {
  ApprovalMiddlewareConfig,
  ToolApprovalDecisionEvent,
  ToolCallContext,
  ToolExecutionOptions,
  ToolLike,
  ToolMatcher,
  ToolMiddleware,
  ToolMiddlewareConfig,
  ToolMiddlewareNext,
} from './types'

interface ApprovalMetadata<TInput = unknown> {
  readonly middlewareId: string
  readonly toolName: string
  readonly match: readonly ToolMatcher[]
  readonly onRequest?: (call: ToolCallContext<TInput>) => void | PromiseLike<void>
  readonly observeRequest?: (call: ToolCallContext<TInput>) => void
  readonly onApproved?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
  readonly onDenied?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
}

const approvalMetadata = new WeakMap<object, ApprovalMetadata>()
const approvalRequestObservers = new WeakMap<object, (call: ToolCallContext) => void>()
const middlewareDefinitionRefs = new WeakMap<object, readonly DefinitionRef[]>()
const wrappedToolDefinitionRefs = new WeakMap<object, readonly DefinitionRef[]>()
const handledApprovals = new Set<string>()

type PartialToolExecutionOptions<TContext = never, TRuntimeContext = unknown> = Partial<
  ToolExecutionOptions<TContext, TRuntimeContext>
>

/** Associate canonical definition evidence with a middleware-created tool wrapper. @internal */
export function withToolMiddlewareDefinitionRef(
  middleware: ToolMiddleware,
  definitionRef: DefinitionRef,
): ToolMiddleware {
  middlewareDefinitionRefs.set(middleware, [definitionRef])
  return middleware
}

/** Attach an internal observer that runs inside the eventual approval span. @internal */
export function withApprovalMiddlewareRequestObserver(
  middleware: ToolMiddleware,
  observer: (call: ToolCallContext) => void,
): ToolMiddleware {
  approvalRequestObservers.set(middleware, observer)
  return middleware
}

/** Read canonical contributor evidence propagated onto a wrapped tool. @internal */
export function toolMiddlewareDefinitionRefs(tool: unknown): readonly DefinitionRef[] {
  return tool !== null && typeof tool === 'object' ? (wrappedToolDefinitionRefs.get(tool) ?? []) : []
}

function completeExecutionOptions<TContext = never, TRuntimeContext = unknown>(
  options: PartialToolExecutionOptions<TContext, TRuntimeContext> | undefined,
): ToolExecutionOptions<TContext, TRuntimeContext> {
  return {
    ...(options ?? {}),
    toolCallId: options?.toolCallId ?? createToolCallId(),
    runtimeContext: options?.runtimeContext as TRuntimeContext,
  } as ToolExecutionOptions<TContext, TRuntimeContext>
}

function callContextField(options: object): { readonly context?: unknown } {
  return Object.prototype.hasOwnProperty.call(options, 'context')
    ? { context: (options as { readonly context?: unknown }).context }
    : {}
}

/**
 * Create a tool middleware that wraps execution with lifecycle hooks.
 *
 * When `match` is provided, only matching tools are wrapped; everything else
 * passes through untouched.
 */
export function toolMiddleware(config: ToolMiddlewareConfig): ToolMiddleware {
  assertNonEmptyId(config.id, 'toolMiddleware')

  return {
    _tag: 'ToolMiddleware',
    id: config.id,
    wrapTool<TInput, TOutput>(toolName: string, tool: ToolLike<TInput, TOutput>): ToolLike<TInput, TOutput> {
      if (typeof tool.execute !== 'function') return tool
      const originalExecute = tool.execute

      return {
        ...tool,
        execute: async (input: TInput, rawOptions?: PartialToolExecutionOptions): Promise<TOutput> => {
          const options = completeExecutionOptions(rawOptions)
          const call = {
            toolName,
            toolCallId: options.toolCallId,
            input,
            options,
            ...callContextField(options),
            runtimeContext: options.runtimeContext,
            messages: options.messages,
          }

          if (config.match && !(await matchesAny(config.match, call))) {
            return originalExecute(input, options)
          }

          const start = Date.now()
          await config.beforeExecute?.(call)
          try {
            const next: ToolMiddlewareNext<unknown, unknown> = (nextInput, nextOptions) =>
              originalExecute(nextInput as TInput, nextOptions)
            const output = await (config.aroundExecute
              ? config.aroundExecute(call, next)
              : originalExecute(input, options))
            await config.afterExecute?.({
              ...call,
              output,
              durationMs: Date.now() - start,
            })
            return output as TOutput
          } catch (error) {
            await config.onError?.({
              ...call,
              error,
              durationMs: Date.now() - start,
            })
            throw error
          }
        },
      }
    },
  }
}

/**
 * Create a middleware that requires human approval for matched tools.
 *
 * Matched tools carry middleware metadata consumed by the tool lifecycle and,
 * on resume, fire the `onApproved`/`onDenied` callbacks via
 * {@link notifyToolApprovalResponses}.
 */
export function approvalMiddleware<TInput = unknown>(config: ApprovalMiddlewareConfig<TInput>): ToolMiddleware {
  assertNonEmptyId(config.id, 'approvalMiddleware')
  if (config.match.length === 0) throw new Error('approvalMiddleware() requires at least one matcher.')

  const middleware: ToolMiddleware = {
    _tag: 'ToolMiddleware',
    id: config.id,
    wrapTool<TToolInput, TOutput>(toolName: string, tool: ToolLike<TToolInput, TOutput>): ToolLike<TToolInput, TOutput> {
      const originalExecute = tool.execute

      const wrapped: ToolLike<TToolInput, TOutput> = {
        ...tool,
        ...(originalExecute
          ? {
              execute: async (input: TToolInput, rawOptions?: PartialToolExecutionOptions) => {
                const options = completeExecutionOptions(rawOptions)
                const call = {
                  toolName,
                  toolCallId: options.toolCallId,
                  input,
                  options,
                  ...callContextField(options),
                  runtimeContext: options.runtimeContext,
                  messages: options.messages,
                }
                if (await matchesAny(config.match, call as unknown as ToolCallContext<TInput>)) {
                  await notifyApprovedFromMessages({
                    toolName,
                    toolCallId: options.toolCallId,
                    input,
                    messages: options.messages,
                    executionOptions: options,
                    onApproved: config.onApproved as ApprovalMetadata<TToolInput>['onApproved'],
                  })
                }
                return originalExecute(input, options)
              },
            }
          : {}),
      }

      approvalMetadata.set(wrapped, {
        middlewareId: config.id,
        toolName,
        match: config.match as readonly ToolMatcher[],
        onRequest: config.onRequest as ApprovalMetadata['onRequest'],
        observeRequest: approvalRequestObservers.get(middleware),
        onApproved: config.onApproved as ApprovalMetadata['onApproved'],
        onDenied: config.onDenied as ApprovalMetadata['onDenied'],
      })
      return wrapped
    },
  }
  return middleware
}

/** Result of evaluating approval middleware for one concrete call. @internal */
export interface ApprovalMiddlewareEvaluation {
  readonly requiresApproval: boolean
  readonly observeRequest?: () => void
}

/** Evaluate approval metadata and retain its span-bound observation callback. @internal */
export async function evaluateApprovalMiddlewareRequest(
  tool: unknown,
  call: ToolCallContext,
): Promise<ApprovalMiddlewareEvaluation> {
  if (!isToolLike(tool)) return { requiresApproval: false }
  const metadata = approvalMetadata.get(tool)
  if (!metadata) return { requiresApproval: false }
  const matched = await matchesAny(metadata.match, call)
  if (!matched) return { requiresApproval: false }
  await metadata.onRequest?.(call)
  return {
    requiresApproval: true,
    ...(metadata.observeRequest ? { observeRequest: () => metadata.observeRequest?.(call) } : {}),
  }
}

/** Evaluate approval middleware metadata attached to a wrapped tool. */
export async function evaluateApprovalMiddleware(tool: unknown, call: ToolCallContext): Promise<boolean> {
  return (await evaluateApprovalMiddlewareRequest(tool, call)).requiresApproval
}

/** Apply a middleware chain across an entire tool set, preserving non-tool values. */
export function applyToolMiddleware<TTools extends Record<string, unknown>>(
  tools: TTools,
  middleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): TTools {
  const chain = Array.isArray(middleware) ? middleware : middleware ? [middleware] : []
  if (chain.length === 0) return tools

  const wrapped: Record<string, unknown> = {}
  for (const [toolName, tool] of Object.entries(tools)) {
    if (!isToolLike(tool)) {
      wrapped[toolName] = tool
      continue
    }

    wrapped[toolName] = chain.reduce<ToolLike>((current, item) => {
      const next = item.wrapTool(toolName, current)
      const refs = [
        ...toolMiddlewareDefinitionRefs(current),
        ...(middlewareDefinitionRefs.get(item) ?? []),
      ]
      if (refs.length > 0) wrappedToolDefinitionRefs.set(next, refs)
      return next
    }, tool)
  }
  return wrapped as TTools
}

/**
 * Fire `onApproved`/`onDenied` callbacks for any approval decisions present in
 * `messages`, deduplicating against already-handled approvals.
 */
export async function notifyToolApprovalResponses(
  tools: Record<string, unknown> | undefined,
  messages: readonly unknown[] | undefined,
): Promise<void> {
  if (!tools || !messages) return

  const approvals = collectToolApprovals(messages)
  for (const approval of approvals) {
    const tool = tools[approval.toolName]
    if (!isToolLike(tool)) continue
    const metadata = approvalMetadata.get(tool)
    if (!metadata) continue

    const key = approvalDecisionKey(approval.approvalId, approval.approved ? 'approved' : 'denied')
    if (handledApprovals.has(key)) continue

    const event: ToolApprovalDecisionEvent = {
      toolName: approval.toolName,
      toolCallId: approval.toolCallId,
      input: approval.input,
      options: completeExecutionOptions({ messages }),
      runtimeContext: undefined,
      messages,
      approvalId: approval.approvalId,
      status: approval.approved ? 'approved' : 'denied',
      ...(approval.reason ? { reason: approval.reason } : {}),
    }
    if (!(await matchesAny(metadata.match, event))) continue
    handledApprovals.add(key)

    if (approval.approved) await metadata.onApproved?.(event)
    else await metadata.onDenied?.(event)
  }
}

async function notifyApprovedFromMessages<TInput>(options: {
  readonly toolName: string
  readonly toolCallId: string | undefined
  readonly input: TInput
  readonly messages: readonly unknown[] | undefined
  readonly executionOptions: ToolExecutionOptions
  readonly onApproved?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
}): Promise<void> {
  if (!options.toolCallId || !options.messages || !options.onApproved) return
  const approval = collectToolApprovals(options.messages).find(
    (candidate) => candidate.toolCallId === options.toolCallId && candidate.approved,
  )
  if (!approval) return

  const key = approvalDecisionKey(approval.approvalId, 'approved')
  if (handledApprovals.has(key)) return
  handledApprovals.add(key)

  await options.onApproved({
    toolName: options.toolName,
    toolCallId: options.toolCallId,
    input: options.input,
    options: options.executionOptions,
    ...callContextField(options.executionOptions),
    runtimeContext: options.executionOptions.runtimeContext,
    messages: options.messages,
    approvalId: approval.approvalId,
    status: 'approved',
    ...(approval.reason ? { reason: approval.reason } : {}),
  })
}
