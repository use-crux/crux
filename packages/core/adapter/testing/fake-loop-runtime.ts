/**
 * `fakeLoopRuntime()` — a fully in-memory {@link LoopRuntimePort} you script
 * with model emissions.
 *
 * Use it to test `loopRuntimeAdapter()` policy (routing, validation retry,
 * approvals, steering) with zero SDK involvement. It is also the reference
 * implementation of the loop runtime contract: it honors `maxSteps`, awaits
 * the observer and applies directives (including `refundStep`), suspends on
 * approval-needing tools, and validates structured scripts against the real
 * schema — the honesty that lets fake-backed policy tests transfer to real SDKs.
 *
 * @module
 */

import type { ModelInfo } from '../../types'
import type { GenerationSettings } from '../../generation/types'
import type { Message } from '../../generation/messages'
import type { AdapterResponse } from '../types'
import type { LoopRuntimePort } from '../loop-runtime-port'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  PendingToolApproval,
  StepDirective,
  StructuredAttempt,
} from '../executor-types'
import { validateStructuredOutput } from '../policy/validation-retry'
import { toJsonValue, renderToolModelOutput, createToolModelOutput, normalizeToolInput } from '../tool/emission'

/** One scripted model emission inside a `runTextLoop` script. */
export interface FakeLoopEmission {
  /** Assistant text for this step. */
  readonly text?: string
  /**
   * Tool calls the "model" requests this step. The fake executes them
   * against the request's (instrumented) tool map, exactly like a real
   * SDK loop would.
   */
  readonly toolCalls?: ReadonlyArray<{ readonly id?: string; readonly name: string; readonly args: unknown }>
}

/** Configuration for {@link fakeLoopRuntime}. */
export interface FakeLoopRuntimeConfig {
  /**
   * Scripts consumed one per `runTextLoop()` call. Each script is the
   * sequence of model emissions for that loop; an `Error` entry makes that
   * call throw (for fallback/routing tests).
   * @defaultValue a single `[{ text: 'fake response' }]` script, reused
   */
  readonly loops?: ReadonlyArray<readonly FakeLoopEmission[] | Error>
  /**
   * Raw model texts consumed one per `runStructuredAttempt()` call. The fake
   * validates each against the request's schema and returns `ok` or
   * `invalid` accordingly — script invalid JSON to drive retry policy.
   */
  readonly structured?: ReadonlyArray<string | Error>
  /** Chunk sequences consumed one per `runStream()` call. */
  readonly streams?: ReadonlyArray<readonly string[]>
  /** Cost reported in every outcome's meta, when set. */
  readonly costUsd?: number
}

/** The raw "SDK result" type produced by the fake loop runtime. */
export interface FakeRawResponse {
  readonly kind: 'fake-loop' | 'fake-structured'
  readonly text: string
  readonly object?: unknown
  /** The system prompt in effect for the FINAL step (observes `amend`). */
  readonly system: string | undefined
}

/** The raw "SDK stream result" type produced by the fake loop runtime. */
export interface FakeRawStream {
  readonly kind: 'fake-stream'
  readonly chunks: readonly string[]
  readonly text: string
}

/** A scripted fake loop runtime plus its recorded calls. */
export interface FakeLoopRuntime {
  /** The {@link LoopRuntimePort} to pass to `loopRuntimeAdapter()`. */
  readonly runtime: LoopRuntimePort<string, FakeRawResponse, FakeRawStream>
  /** Every request each method received, in call order — assert on these. */
  readonly calls: {
    readonly runTextLoop: Array<ExecutorRequest<string>>
    readonly runStructuredAttempt: Array<ExecutorRequest<string>>
    readonly runStream: Array<ExecutorRequest<string>>
  }
}

const FAKE_USAGE = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const

interface FakeToolLike {
  execute?: (input: unknown, options: { toolCallId?: string; messages?: readonly unknown[] }) => unknown
  needsApproval?:
    | boolean
    | ((
        input: unknown,
        options: { toolCallId?: string; messages?: readonly unknown[] },
      ) => boolean | PromiseLike<boolean>)
  toModelOutput?: (args: {
    toolCallId: string
    input: Record<string, unknown>
    output: unknown
  }) => import('../../types/tool').ToolModelOutput | Promise<import('../../types/tool').ToolModelOutput>
}

/**
 * Create a scripted, fully in-memory {@link LoopRuntimePort} — the official
 * test double for `loopRuntimeAdapter()` and the reference implementation of
 * the loop runtime contract.
 *
 * You script *model behavior* (text, tool calls, raw structured output); the
 * fake supplies honest contract mechanics. That honesty is what makes policy
 * tests written against it transfer to real SDKs.
 *
 * @param config - Scripts for each method; see {@link FakeLoopRuntimeConfig}.
 *
 * @example
 * ```ts
 * import { loopRuntimeAdapter, fakeLoopRuntime } from '@use-crux/core/adapter'
 *
 * const fake = fakeLoopRuntime({ structured: ['not json', '{"title":"ok","count":1}'] })
 * const executor = loopRuntimeAdapter(fake.runtime)
 *
 * const result = await executor.generate(myStructuredPrompt, {
 *   model: 'fake:m-1',
 *   input: { instruction: 'go' },
 *   validationRetry: { maxRetries: 2 },
 * })
 * expect(fake.calls.runStructuredAttempt).toHaveLength(2)
 * ```
 */
export function fakeLoopRuntime(config: FakeLoopRuntimeConfig = {}): FakeLoopRuntime {
  const loops = [...(config.loops ?? [])]
  const structured = [...(config.structured ?? [])]
  const streams = [...(config.streams ?? [])]
  const calls: FakeLoopRuntime['calls'] = { runTextLoop: [], runStructuredAttempt: [], runStream: [] }

  const runtime: LoopRuntimePort<string, FakeRawResponse, FakeRawStream> = {
    id: 'fake',

    describeModel(model: string): ModelInfo {
      const idx = model.indexOf(':')
      if (idx > 0) return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) }
      return { provider: 'fake', modelId: model }
    },

    mapSettings(settings: GenerationSettings): Record<string, unknown> {
      return { ...settings }
    },

    async runTextLoop(request): Promise<ExecutorOutcome<FakeRawResponse>> {
      calls.runTextLoop.push(request)
      const script = loops.shift() ?? [{ text: 'fake response' }]
      if (script instanceof Error) throw script

      let system = request.system
      let tools = request.tools
      let activeTools = request.activeTools
      let messages: Message[] = [...(request.messages ?? [])]
      if (messages.length === 0 && request.prompt) {
        messages = [{ role: 'user', content: request.prompt }]
      }

      let steps = 0
      let lastResponse: AdapterResponse = {
        text: '',
        toolCalls: undefined,
        usage: { ...FAKE_USAGE },
        finishReason: 'stop',
        responseId: undefined,
        actualModelId: request.modelInfo.modelId,
      }

      for (let index = 0; index < script.length; index++) {
        if (steps >= request.maxSteps) break
        steps++
        const emission = script[index]!
        const toolCalls = (emission.toolCalls ?? []).map((tc, j) => ({
          id: tc.id ?? `tc_${index}_${j}`,
          name: tc.name,
          args: tc.args,
        }))

        lastResponse = {
          text: emission.text ?? '',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: { ...FAKE_USAGE },
          finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          responseId: `fake_${index}`,
          actualModelId: request.modelInfo.modelId,
        }

        if (toolCalls.length === 0) {
          messages = [...messages, { role: 'assistant', content: lastResponse.text }]
          await request.observer?.onStepEnd({
            index: steps - 1,
            text: lastResponse.text,
            toolCalls: [],
            toolResults: [],
            finishReason: 'stop',
            usage: lastResponse.usage,
          })
          break
        }

        // Approval scan first: a real SDK detects needsApproval before executing.
        for (const tc of toolCalls) {
          const tool = lookupTool(tools, activeTools, tc.name)
          if (tool && (await needsApproval(tool, tc, messages))) {
            const pending: PendingToolApproval = {
              toolCallId: tc.id,
              toolName: tc.name,
              input: toJsonValue(tc.args),
            }
            return {
              status: 'suspended',
              reason: 'tool-approval',
              pendingApprovals: [pending],
              assistantResponse: lastResponse,
              messages,
              steps,
            }
          }
        }

        const toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }> = []
        const toolMessages: Message[] = []
        for (const tc of toolCalls) {
          const tool = lookupTool(tools, activeTools, tc.name)
          let output: unknown
          try {
            output = tool?.execute ? await tool.execute(tc.args, { toolCallId: tc.id, messages }) : undefined
          } catch (error) {
            output = { error: error instanceof Error ? error.message : String(error) }
          }
          toolResults.push({ toolCallId: tc.id, toolName: tc.name, output })
          const modelOutput = tool
            ? await createToolModelOutput({ tool, toolCallId: tc.id, input: normalizeToolInput(tc.args), output })
            : ({ type: 'error-json', value: { error: `Tool "${tc.name}" not found` } } as const)
          toolMessages.push({
            role: 'tool',
            content: renderToolModelOutput(modelOutput),
            metadata: { toolCallId: tc.id, toolName: tc.name },
          })
        }

        messages = [
          ...messages,
          { role: 'assistant', content: lastResponse.text, metadata: { toolCalls } },
          ...toolMessages,
        ]

        const directive: StepDirective = (await request.observer?.onStepEnd({
          index: steps - 1,
          text: lastResponse.text,
          toolCalls,
          toolResults,
          finishReason: 'tool_calls',
          usage: lastResponse.usage,
        })) ?? { kind: 'continue' }

        if (directive.kind === 'stop') break
        if (directive.kind === 'amend') {
          if (directive.system !== undefined) system = directive.system
          if (directive.tools !== undefined) tools = directive.tools
          if (directive.activeTools !== undefined) activeTools = directive.activeTools
          if (directive.refundStep) steps--
        }
      }

      return {
        status: 'complete',
        raw: { kind: 'fake-loop', text: lastResponse.text, system },
        response: lastResponse,
        messages,
        steps,
        meta: config.costUsd !== undefined ? { costUsd: config.costUsd } : {},
      }
    },

    async runStructuredAttempt(request): Promise<StructuredAttempt<FakeRawResponse>> {
      calls.runStructuredAttempt.push(request)
      const scripted = structured.shift() ?? '{}'
      if (scripted instanceof Error) throw scripted

      const validation = validateStructuredOutput(scripted, request.schema)
      if (!validation.valid) {
        return { status: 'invalid', rawText: scripted, error: validation.error! }
      }
      const object: unknown = JSON.parse(validation.repairedText)
      return {
        status: 'ok',
        raw: { kind: 'fake-structured', text: validation.repairedText, object, system: request.system },
        response: {
          text: validation.repairedText,
          toolCalls: undefined,
          usage: { ...FAKE_USAGE },
          finishReason: 'stop',
          responseId: 'fake_structured',
          actualModelId: request.modelInfo.modelId,
        },
        object,
      }
    },

    async runStream(request): Promise<ExecutorStreamHandle<FakeRawStream>> {
      calls.runStream.push(request)
      const scripted = streams.shift() ?? ['fake ', 'stream']

      // Drive the safety streaming sub-protocol exactly as a real port must:
      // feed deltas, forward emits, swallow holds, append the seal's pending
      // tail. Blocks reject the stream.
      let chunks: readonly string[] = scripted
      if (request.safety) {
        const emitted: string[] = []
        for (const chunk of scripted) {
          const directive = await request.safety.feed(chunk)
          if (directive.kind === 'emit' && directive.content.length > 0) emitted.push(directive.content)
        }
        const seal = await request.safety.finish()
        if (seal.pending.length > 0) emitted.push(seal.pending)
        chunks = emitted
      }

      const text = chunks.join('')
      return {
        raw: { kind: 'fake-stream', chunks, text },
        completion: async () => ({
          text,
          usage: FAKE_USAGE,
          finishReason: 'stop',
          streaming: { totalChunks: chunks.length, ttftMs: 1 },
        }),
      }
    },
  }

  return { runtime, calls }
}

function lookupTool(
  tools: Record<string, unknown> | undefined,
  activeTools: readonly string[] | undefined,
  name: string,
): FakeToolLike | undefined {
  if (!tools) return undefined
  if (activeTools && !activeTools.includes(name)) return undefined
  const tool = tools[name]
  return tool && typeof tool === 'object' ? (tool as FakeToolLike) : undefined
}

async function needsApproval(
  tool: FakeToolLike,
  toolCall: { id: string; args: unknown },
  messages: readonly Message[],
): Promise<boolean> {
  if (tool.needsApproval === undefined) return false
  if (typeof tool.needsApproval === 'boolean') return tool.needsApproval
  return Boolean(await tool.needsApproval(toolCall.args, { toolCallId: toolCall.id, messages }))
}
