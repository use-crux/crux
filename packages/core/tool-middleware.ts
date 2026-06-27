import type { JsonValue, ToolModelOutput } from './types/tool'
import { getRuntime } from './runtime/runtime'
import { getExecutionContext } from './runtime/execution-context'

export type ToolApprovalStatus = 'approved' | 'denied'

export interface ToolApprovalRequestPayload {
  readonly title?: string
  readonly description?: string
  readonly details?: JsonValue
}

export interface ToolApprovalRequestPart {
  readonly type: 'tool-approval-request'
  readonly approvalId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly input: JsonValue
  readonly request?: ToolApprovalRequestPayload
  readonly approvalToken?: string
}

export interface ToolApprovalResponsePart {
  readonly type: 'tool-approval-response'
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}

export interface ToolApprovalRequest {
  readonly approvalId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly input: unknown
  readonly request?: ToolApprovalRequestPayload
  readonly approvalToken?: string
}

export interface ToolApprovalDecision {
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}

export interface ToolCallContext<TInput = unknown> {
  readonly toolName: string
  readonly toolCallId: string
  readonly input: TInput
  readonly options: ToolExecutionOptions
  readonly messages?: readonly unknown[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ToolResultContext<TInput = unknown, TOutput = unknown> extends ToolCallContext<TInput> {
  readonly output: TOutput
  readonly durationMs: number
}

export interface ToolErrorContext<TInput = unknown> extends ToolCallContext<TInput> {
  readonly error: unknown
  readonly durationMs: number
}

export type ToolMatcher<TInput = unknown> =
  | string
  | RegExp
  | ((call: ToolCallContext<TInput>) => boolean | PromiseLike<boolean>)

export type ToolMiddlewareNext<TInput, TOutput> = (
  input: TInput,
  options: ToolExecutionOptions,
) => TOutput | PromiseLike<TOutput>

export interface ToolExecutionOptions {
  readonly toolCallId?: string
  readonly messages?: readonly unknown[]
  readonly [key: string]: unknown
}

export type ToolExecuteFunction<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  options: ToolExecutionOptions,
) => TOutput | PromiseLike<TOutput>

export interface ToolLike<TInput = unknown, TOutput = unknown> {
  readonly description?: string
  readonly title?: string
  readonly execute?: ToolExecuteFunction<TInput, TOutput>
  readonly needsApproval?:
    | boolean
    | ((input: TInput, options: ToolExecutionOptions) => boolean | PromiseLike<boolean>)
  readonly toModelOutput?: (args: {
    readonly toolCallId: string
    readonly input: TInput
    readonly output: TOutput
  }) => ToolModelOutput | PromiseLike<ToolModelOutput>
  readonly [key: string]: unknown
}

export interface ToolMiddleware {
  readonly _tag: 'ToolMiddleware'
  readonly id: string
  wrapTool<TInput, TOutput>(
    toolName: string,
    tool: ToolLike<TInput, TOutput>,
  ): ToolLike<TInput, TOutput>
}

export interface ToolMiddlewareConfig {
  readonly id: string
  readonly match?: readonly ToolMatcher[]
  readonly beforeExecute?: (call: ToolCallContext) => void | PromiseLike<void>
  readonly aroundExecute?: (
    call: ToolCallContext,
    next: ToolMiddlewareNext<unknown, unknown>,
  ) => unknown | PromiseLike<unknown>
  readonly afterExecute?: (result: ToolResultContext) => void | PromiseLike<void>
  readonly onError?: (error: ToolErrorContext) => void | PromiseLike<void>
}

export interface ApprovalMiddlewareConfig<TInput = unknown> {
  readonly id: string
  readonly match: readonly ToolMatcher<TInput>[]
  readonly onRequest?: (call: ToolCallContext<TInput>) => void | PromiseLike<void>
  readonly onApproved?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
  readonly onDenied?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
}

export interface ToolApprovalDecisionEvent<TInput = unknown> extends ToolCallContext<TInput> {
  readonly approvalId: string
  readonly status: ToolApprovalStatus
  readonly reason?: string
}

interface ApprovalMetadata<TInput = unknown> {
  readonly middlewareId: string
  readonly toolName: string
  readonly match: readonly ToolMatcher[]
  readonly onApproved?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
  readonly onDenied?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
}

const approvalMetadata = new WeakMap<object, ApprovalMetadata>()
const handledApprovals = new Set<string>()

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
        execute: async (input: TInput, options: ToolExecutionOptions = {}): Promise<TOutput> => {
          const toolCallId = options.toolCallId ?? createToolCallId()
          const call = { toolName, toolCallId, input, options, messages: options.messages }

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

export function approvalMiddleware<TInput = unknown>(config: ApprovalMiddlewareConfig<TInput>): ToolMiddleware {
  assertNonEmptyId(config.id, 'approvalMiddleware')
  if (config.match.length === 0) throw new Error('approvalMiddleware() requires at least one matcher.')

  return {
    _tag: 'ToolMiddleware',
    id: config.id,
    wrapTool<TToolInput, TOutput>(toolName: string, tool: ToolLike<TToolInput, TOutput>): ToolLike<TToolInput, TOutput> {
      const originalNeedsApproval = tool.needsApproval
      const originalExecute = tool.execute

      const wrapped: ToolLike<TToolInput, TOutput> = {
        ...tool,
        needsApproval: async (input: TToolInput, options: ToolExecutionOptions = {}) => {
          const toolCallId = options.toolCallId ?? createToolCallId()
          const call = { toolName, toolCallId, input, options, messages: options.messages }
          const originalDecision = await evaluateNeedsApproval(originalNeedsApproval, input, options)
          const matched = await matchesAny(config.match, call as unknown as ToolCallContext<TInput>)
          if (matched) {
            await config.onRequest?.(call as unknown as ToolCallContext<TInput>)
          }
          if (originalDecision || matched) {
            return true
          }
          return false
        },
        ...(originalExecute
          ? {
              execute: async (input: TToolInput, options: ToolExecutionOptions = {}) => {
                const call = {
                  toolName,
                  toolCallId: options.toolCallId ?? createToolCallId(),
                  input,
                  options,
                  messages: options.messages,
                }
                if (await matchesAny(config.match, call as unknown as ToolCallContext<TInput>)) {
                  await notifyApprovedFromMessages({
                    toolName,
                    toolCallId: options.toolCallId,
                    input,
                    messages: options.messages,
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
        onApproved: config.onApproved as ApprovalMetadata['onApproved'],
        onDenied: config.onDenied as ApprovalMetadata['onDenied'],
      })
      return wrapped
    },
  }
}

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

    wrapped[toolName] = chain.reduce<ToolLike>(
      (current, item) => item.wrapTool(toolName, current),
      tool,
    )
  }
  return wrapped as TTools
}

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
      options: {},
      messages,
      approvalId: approval.approvalId,
      status: approval.approved ? 'approved' : 'denied',
      ...(approval.reason ? { reason: approval.reason } : {}),
    }
    if (!(await matchesAny(metadata.match, event))) continue
    handledApprovals.add(key)

    getRuntime().instrumentationHooks?.onToolApprovalDecision?.({
      approvalId: approval.approvalId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      approved: approval.approved,
      ...(approval.reason ? { reason: approval.reason } : {}),
      traceId: getExecutionContext()?.traceId,
    })

    if (approval.approved) await metadata.onApproved?.(event)
    else await metadata.onDenied?.(event)
  }
}

export function toolApprovalResponse(options: {
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}): ToolApprovalResponsePart {
  return {
    type: 'tool-approval-response',
    approvalId: options.approvalId,
    approved: options.approved,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.approvalToken ? { approvalToken: options.approvalToken } : {}),
  }
}

export function toolApprovalResponseMessage(options: {
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}): {
  readonly role: 'tool'
  readonly content: string
  readonly metadata: { readonly toolApprovalResponse: ToolApprovalResponsePart }
} {
  return {
    role: 'tool',
    content: '',
    metadata: {
      toolApprovalResponse: toolApprovalResponse(options),
    },
  }
}

export function appendToolApprovalResponse<TMessage>(
  messages: readonly TMessage[],
  response: {
    readonly approvalId: string
    readonly approved: boolean
    readonly reason?: string
    readonly approvalToken?: string
  },
): Array<TMessage | ReturnType<typeof toolApprovalResponseMessage>> {
  return [...messages, toolApprovalResponseMessage(response)]
}

export function findToolApprovalRequests(messages: readonly unknown[] | undefined): ToolApprovalRequest[] {
  if (!messages) return []
  return collectToolApprovalRequests(messages)
}

export function findToolApprovalDecision(
  messages: readonly unknown[] | undefined,
  approvalId: string,
): ToolApprovalDecision | undefined {
  if (!messages) return undefined
  return collectToolApprovalDecisions(messages).find((decision) => decision.approvalId === approvalId)
}

export function deniedToolModelOutput(reason?: string): ToolModelOutput {
  return { type: 'execution-denied', ...(reason ? { reason } : {}) }
}

async function notifyApprovedFromMessages<TInput>(options: {
  readonly toolName: string
  readonly toolCallId: string | undefined
  readonly input: TInput
  readonly messages: readonly unknown[] | undefined
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
    options: {},
    messages: options.messages,
    approvalId: approval.approvalId,
    status: 'approved',
    ...(approval.reason ? { reason: approval.reason } : {}),
  })
}

function collectToolApprovals(messages: readonly unknown[]): Array<{
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
  approved: boolean
  reason?: string
}> {
  const toolCalls = collectToolCalls(messages)
  const requests = new Map(
    collectToolApprovalRequests(messages).map((request) => [
      request.approvalId,
      {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        input: request.input,
      },
    ]),
  )
  const responses = collectToolApprovalDecisions(messages)

  return responses.flatMap((response) => {
    const request = requests.get(response.approvalId)
    if (!request) return []
    const call = toolCalls.get(request.toolCallId)
    const toolName = request.toolName ?? call?.toolName
    if (!toolName) return []
    return [
      {
        approvalId: response.approvalId,
        toolCallId: request.toolCallId,
        toolName,
        input: request.input ?? call?.input,
        approved: response.approved,
        ...(response.reason ? { reason: response.reason } : {}),
      },
    ]
  })
}

function collectToolCalls(messages: readonly unknown[]): Map<string, { toolName: string; input: unknown }> {
  const toolCalls = new Map<string, { toolName: string; input: unknown }>()

  for (const message of messages) {
    const role = readStringProperty(message, 'role')
    const content = readProperty(message, 'content')
    const metadata = readProperty(message, 'metadata')

    const metadataToolCalls = readProperty(metadata, 'toolCalls')
    if (role === 'assistant' && Array.isArray(metadataToolCalls)) {
      for (const call of metadataToolCalls) {
        const toolCallId = readStringProperty(call, 'id') ?? readStringProperty(call, 'toolCallId')
        const toolName = readStringProperty(call, 'name') ?? readStringProperty(call, 'toolName')
        if (toolCallId && toolName) {
          toolCalls.set(toolCallId, {
            toolName,
            input: readProperty(call, 'args') ?? readProperty(call, 'input'),
          })
        }
      }
    }

    if (!Array.isArray(content)) continue

    for (const part of content) {
      const type = readStringProperty(part, 'type')
      if (role === 'assistant' && type === 'tool-call') {
        const toolCallId = readStringProperty(part, 'toolCallId')
        const toolName = readStringProperty(part, 'toolName')
        if (toolCallId && toolName) {
          toolCalls.set(toolCallId, {
            toolName,
            input: readProperty(part, 'input') ?? readProperty(part, 'args'),
          })
        }
      }
    }
  }

  return toolCalls
}

function collectToolApprovalRequests(messages: readonly unknown[]): ToolApprovalRequest[] {
  const requests: ToolApprovalRequest[] = []
  const toolCalls = collectToolCalls(messages)

  for (const message of messages) {
    const role = readStringProperty(message, 'role')
    const content = readProperty(message, 'content')
    const metadata = readProperty(message, 'metadata')

    const metadataRequests = readProperty(metadata, 'toolApprovalRequests')
    if (role === 'assistant' && Array.isArray(metadataRequests)) {
      for (const request of metadataRequests) {
        const normalized = normalizeApprovalRequest(request)
        const completed = completeApprovalRequest(normalized, toolCalls)
        if (completed) requests.push(completed)
      }
    }

    if (!Array.isArray(content)) continue

    for (const part of content) {
      const type = readStringProperty(part, 'type')

      if (role === 'assistant' && type === 'tool-approval-request') {
        const normalized = normalizeApprovalRequest(part)
        const completed = completeApprovalRequest(normalized, toolCalls)
        if (completed) requests.push(completed)
      }
    }
  }

  return requests
}

function collectToolApprovalDecisions(messages: readonly unknown[]): ToolApprovalDecision[] {
  const responses: ToolApprovalDecision[] = []

  for (const message of messages) {
    const role = readStringProperty(message, 'role')
    const content = readProperty(message, 'content')
    const metadata = readProperty(message, 'metadata')

    const metadataResponse = readProperty(metadata, 'toolApprovalResponse')
    const normalizedMetadataResponse = normalizeApprovalDecision(metadataResponse)
    if (role === 'tool' && normalizedMetadataResponse) {
      responses.push(normalizedMetadataResponse)
    }

    if (!Array.isArray(content)) continue

    for (const part of content) {
      const type = readStringProperty(part, 'type')
      if (role === 'tool' && type === 'tool-approval-response') {
        const normalized = normalizeApprovalDecision(part)
        if (normalized) responses.push(normalized)
      }
    }
  }

  return responses
}

function normalizeApprovalRequest(value: unknown): ToolApprovalRequest | undefined {
  const approvalId = readStringProperty(value, 'approvalId')
  const toolCall = readProperty(value, 'toolCall')
  const toolCallId = readStringProperty(value, 'toolCallId') ?? readStringProperty(toolCall, 'toolCallId')
  const toolName = readStringProperty(value, 'toolName') ?? readStringProperty(toolCall, 'toolName')
  if (!approvalId || !toolCallId) return undefined

  return {
    approvalId,
    toolCallId,
    toolName: toolName ?? '',
    input: readProperty(value, 'input') ?? readProperty(toolCall, 'input') ?? readProperty(toolCall, 'args'),
    ...(isApprovalRequestPayload(readProperty(value, 'request')) ? { request: readProperty(value, 'request') as ToolApprovalRequestPayload } : {}),
    ...(readStringProperty(value, 'approvalToken') ? { approvalToken: readStringProperty(value, 'approvalToken') } : {}),
  }
}

function completeApprovalRequest(
  request: ToolApprovalRequest | undefined,
  toolCalls: Map<string, { toolName: string; input: unknown }>,
): ToolApprovalRequest | undefined {
  if (!request) return undefined
  const call = toolCalls.get(request.toolCallId)
  const toolName = request.toolName || call?.toolName
  if (!toolName) return undefined
  return {
    ...request,
    toolName,
    input: request.input ?? call?.input,
  }
}

function normalizeApprovalDecision(value: unknown): ToolApprovalDecision | undefined {
  const approvalId = readStringProperty(value, 'approvalId')
  const approved = readBooleanProperty(value, 'approved')
  if (approvalId && approved !== undefined) {
    return {
      approvalId,
      approved,
      ...(readStringProperty(value, 'reason') ? { reason: readStringProperty(value, 'reason') } : {}),
      ...(readStringProperty(value, 'approvalToken') ? { approvalToken: readStringProperty(value, 'approvalToken') } : {}),
    }
  }
  return undefined
}

function isApprovalRequestPayload(value: unknown): value is ToolApprovalRequestPayload {
  return value !== null && typeof value === 'object'
}

function isToolLike(value: unknown): value is ToolLike {
  return value !== null && typeof value === 'object'
}

async function evaluateNeedsApproval<TInput>(
  needsApproval: ToolLike<TInput>['needsApproval'],
  input: TInput,
  options: ToolExecutionOptions,
): Promise<boolean> {
  if (needsApproval === undefined) return false
  if (typeof needsApproval === 'boolean') return needsApproval
  return Boolean(await needsApproval(input, options))
}

async function matchesAny<TInput>(
  matchers: readonly ToolMatcher<TInput>[],
  call: ToolCallContext<TInput>,
): Promise<boolean> {
  for (const matcher of matchers) {
    if (typeof matcher === 'string' && matcher === call.toolName) return true
    if (matcher instanceof RegExp && matcher.test(call.toolName)) return true
    if (typeof matcher === 'function' && (await matcher(call))) return true
  }
  return false
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readProperty(value, key)
  return typeof property === 'string' ? property : undefined
}

function readBooleanProperty(value: unknown, key: string): boolean | undefined {
  const property = readProperty(value, key)
  return typeof property === 'boolean' ? property : undefined
}

function assertNonEmptyId(id: string, name: string): void {
  if (!id.trim()) throw new Error(`${name}() requires a non-empty id.`)
}

function createToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function approvalDecisionKey(approvalId: string, status: ToolApprovalStatus): string {
  return `approval:${approvalId}:${status}`
}
