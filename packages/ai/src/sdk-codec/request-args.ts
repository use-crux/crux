import { jsonSchema, type LanguageModel } from 'ai'
import type { Message } from '@use-crux/core'
import type { ExecutorRequest } from '@use-crux/core/adapter'
import { buildSystemArg } from '../provider-profile'
import { toModelMessages } from '../messages'
import { TOOL_ERROR_REPORTER } from './tool-call-repair'

/** Mutable SDK-argument bag used while planning a call. */
export type LoopArgs = Record<string, unknown>

/**
 * Build the shared AI SDK argument set for text, structured, and stream calls.
 *
 * The result intentionally stays structural: each AI SDK method has a wide
 * generic argument type, and the final plan narrows it to the selected gateway
 * method after mode-specific fields are attached.
 *
 * @internal
 */
export function buildBaseArgs(request: ExecutorRequest<LanguageModel>, options: { includeTools: boolean }): LoopArgs {
  const args: LoopArgs = {
    model: request.model,
    ...request.settings,
  }

  const systemArg = buildSystemArg(request.systemBlocks, request.system, request.modelInfo)
  if (systemArg !== undefined) args.system = systemArg

  if (request.nativeMessages && request.nativeMessages.length > 0) {
    args.messages = request.nativeMessages.map(copyNativeMessage)
  } else if (request.messages && request.messages.length > 0) {
    args.messages = toModelMessages(request.messages, {
      provider: request.modelInfo.provider || 'ai-sdk',
      diagnostics: request.diagnostics,
    })
  } else if (request.prompt) {
    args.prompt = request.prompt
  }

  if (options.includeTools) {
    if (request.planStep) args.tools = {}
    syncToolArgs(args, request)
    if (request.activeTools && request.activeTools.length > 0) args.activeTools = [...request.activeTools]
    const toolChoice = request.extra?.toolChoice
    if (toolChoice !== undefined) args.toolChoice = toolChoice
  }

  if (request.extra?.providerOptions !== undefined) {
    args.providerOptions = mergeProviderOptions(args.providerOptions, request.extra.providerOptions)
  }
  if (request.extra?.headers !== undefined) args.headers = request.extra.headers
  if (request.extra?.maxRetries !== undefined) args.maxRetries = request.extra.maxRetries
  if (request.abortSignal) args.abortSignal = request.abortSignal
  return args
}

/** Refresh the stable Tool map observed by an SDK-owned native loop. @internal */
export function syncToolArgs(
  args: LoopArgs,
  request: ExecutorRequest<LanguageModel>,
): void {
  const current = isRecord(args.tools) ? args.tools : undefined
  const approvalTools = request.tools
    ? request.toolApproval
      ? withSdkToolApproval(request.tools, request.toolApproval)
      : request.tools
    : {}
  const next = installToolWireSchemas(
    approvalTools,
    request.toolWireSchemas,
  )
  if (!current) {
    if (Object.keys(next).length > 0) args.tools = next
    return
  }
  const repairReporter = current[TOOL_ERROR_REPORTER]
  for (const name of Object.keys(current)) delete current[name]
  Object.assign(current, next)
  if (repairReporter !== undefined) {
    current[TOOL_ERROR_REPORTER] = repairReporter
  }
}

function copyNativeMessage(message: unknown): unknown {
  if (!isRecord(message)) return message
  return {
    ...message,
    ...(Array.isArray(message.content) ? { content: [...message.content] } : {}),
  }
}

const sdkApprovalHook = `needs${'Approval'}`

function withSdkToolApproval(
  tools: Record<string, unknown>,
  toolApproval: NonNullable<ExecutorRequest<LanguageModel>['toolApproval']>,
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {}
  for (const [toolName, tool] of Object.entries(tools)) {
    wrapped[toolName] = isRecord(tool)
      ? {
          ...tool,
          [sdkApprovalHook]: (input: unknown, options?: { readonly toolCallId?: string; readonly messages?: Message[] }) =>
            toolApproval({
              toolName,
              toolCallId: options?.toolCallId ?? '',
              input,
              messages: options?.messages,
            }),
        }
      : tool
  }
  return wrapped
}

/**
 * Install core's compiled wire schema as each tool's SDK `inputSchema`.
 *
 * Core owns tool-argument compilation and the sole authored validation; the SDK
 * must receive only the structural wire schema so it never runs the tool's
 * authored validator (a Zod schema or an AI SDK schema's own `validate`), which
 * the wrapped `execute` applies exactly once, after decoding and middleware.
 */
function installToolWireSchemas(
  tools: Record<string, unknown>,
  wireSchemas: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!wireSchemas) return tools
  const result: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const wire = wireSchemas[name]
    result[name] =
      wire && isRecord(tool)
        ? { ...tool, inputSchema: jsonSchema(wire as Parameters<typeof jsonSchema>[0]) }
        : tool
  }
  return result
}

function mergeProviderOptions(current: unknown, next: unknown): unknown {
  if (!isRecord(current) || !isRecord(next)) return next
  const merged: Record<string, unknown> = { ...current }
  for (const [provider, options] of Object.entries(next)) {
    const existing = isRecord(merged[provider]) ? merged[provider] : {}
    merged[provider] = isRecord(options) ? { ...existing, ...options } : options
  }
  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Recreate the canonical prompt/messages base that core expects in loop
 * outcomes before appending AI SDK response messages.
 *
 * @internal
 */
export function canonicalBase(request: ExecutorRequest<LanguageModel>): Message[] {
  if (request.messages && request.messages.length > 0) return [...request.messages]
  if (request.prompt) return [{ role: 'user', content: request.prompt }]
  return []
}
