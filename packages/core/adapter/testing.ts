/**
 * Test utilities for the `ExecutorSpec` contract.
 *
 * - {@link fakeExecutor} — a fully in-memory `ExecutorSpec` you script with
 *   model emissions. Use it to test `executorAdapter()` policy (routing,
 *   validation retry, approvals, steering) with zero SDK involvement.
 * - {@link executorSpecConformance} — the contract suite every
 *   `ExecutorSpec` implementation must pass, including `fakeExecutor`
 *   itself. Run it against a real executor to prove the subtle loop
 *   semantics (directive buffering, step refunds, suspension) hold.
 *
 * @module
 */

import { z } from 'zod'
import type { GenerationSettings, ModelInfo } from '../types'
import type { Message } from '../messages'
import type { AdapterResponse } from './types'
import type { ExecutorSpec } from './executor-spec'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  PendingToolApproval,
  StepDirective,
  StructuredAttempt,
  StructuredRequest,
} from './executor-types'
import { validateStructuredOutput } from './policy/validation-retry'
import { toJsonValue, renderToolModelOutput, createToolModelOutput, normalizeToolInput } from './tool/emission'

export { adapterSpecConformance } from './testing/native'
export { transcriptCodecConformance } from './testing/transcript'
export type {
  AdapterConformanceCapabilities,
  AdapterConformanceEmission,
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformancePrepared,
  AdapterConformanceScript,
} from './testing/native'
export type { TranscriptConformanceScenario, TranscriptWrapperExpectation } from './testing/transcript'

// ─────────────────────────────────────────────────────────────────
// fakeExecutor
// ─────────────────────────────────────────────────────────────────

/** One scripted model emission inside a `runLoop` script. */
export interface FakeExecutorEmission {
  /** Assistant text for this step. */
  readonly text?: string
  /**
   * Tool calls the "model" requests this step. The fake executes them
   * against the request's (instrumented) tool map, exactly like a real
   * SDK loop would.
   */
  readonly toolCalls?: ReadonlyArray<{ readonly id?: string; readonly name: string; readonly args: unknown }>
}

/** Configuration for {@link fakeExecutor}. */
export interface FakeExecutorConfig {
  /**
   * Scripts consumed one per `runLoop()` call. Each script is the sequence
   * of model emissions for that loop; an `Error` entry makes that call
   * throw (for fallback/routing tests).
   * @defaultValue a single `[{ text: 'fake response' }]` script, reused
   */
  readonly loops?: ReadonlyArray<readonly FakeExecutorEmission[] | Error>
  /**
   * Raw model texts consumed one per `attemptStructured()` call. The fake
   * validates each against the request's schema and returns `ok` or
   * `invalid` accordingly — script invalid JSON to drive retry policy.
   */
  readonly structured?: ReadonlyArray<string | Error>
  /** Chunk sequences consumed one per `runStream()` call. */
  readonly streams?: ReadonlyArray<readonly string[]>
  /** Cost reported in every outcome's meta, when set. */
  readonly costUsd?: number
}

/** The raw "SDK result" type produced by the fake executor. */
export interface FakeRawResponse {
  readonly kind: 'fake-loop' | 'fake-structured'
  readonly text: string
  readonly object?: unknown
  /** The system prompt in effect for the FINAL step (observes `amend`). */
  readonly system: string | undefined
}

/** The raw "SDK stream result" type produced by the fake executor. */
export interface FakeRawStream {
  readonly kind: 'fake-stream'
  readonly chunks: readonly string[]
  readonly text: string
}

/** Marker client type for the fake executor. */
export interface FakeExecutorClient {
  readonly kind: 'fake-executor-client'
}

/** A scripted fake executor plus its recorded calls. */
export interface FakeExecutor {
  /** The `ExecutorSpec` to pass to `executorAdapter()`. */
  readonly spec: ExecutorSpec<FakeExecutorClient, string, FakeRawResponse, FakeRawStream>
  /** The client instance to bind the factory with. */
  readonly client: FakeExecutorClient
  /** Every request each method received, in call order — assert on these. */
  readonly calls: {
    readonly runLoop: Array<ExecutorRequest<string>>
    readonly attemptStructured: Array<StructuredRequest<string>>
    readonly runStream: Array<ExecutorRequest<string>>
  }
}

const FAKE_USAGE = { inputTokens: 10, outputTokens: 20, totalTokens: 30 } as const

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
  }) => import('../types/tool').ToolModelOutput | Promise<import('../types/tool').ToolModelOutput>
}

/**
 * Create a scripted, fully in-memory `ExecutorSpec` — the official test
 * double for `executorAdapter()` and the reference implementation of the
 * executor contract.
 *
 * You script *model behavior* (text, tool calls, raw structured output);
 * the fake supplies honest contract mechanics: it executes tools from the
 * request's tool map, honors `maxSteps`, awaits the observer and applies
 * directives (including `refundStep`), suspends on approval-needing tools,
 * and validates structured scripts against the real schema. That honesty
 * is what makes policy tests written against it transfer to real SDKs.
 *
 * @param config - Scripts for each method; see {@link FakeExecutorConfig}.
 *
 * @example
 * ```ts
 * import { executorAdapter, fakeExecutor } from '@crux/core/adapter'
 *
 * const fake = fakeExecutor({
 *   structured: ['not json', '{"title":"ok","count":1}'],
 * })
 * const executor = executorAdapter(fake.spec)(fake.client)
 *
 * const result = await executor.generate(myStructuredPrompt, {
 *   model: 'fake:m-1',
 *   input: { instruction: 'go' },
 *   validationRetry: { maxRetries: 2 },
 * })
 * expect(fake.calls.attemptStructured).toHaveLength(2)
 * ```
 */
export function fakeExecutor(config: FakeExecutorConfig = {}): FakeExecutor {
  const loops = [...(config.loops ?? [])]
  const structured = [...(config.structured ?? [])]
  const streams = [...(config.streams ?? [])]
  const calls: FakeExecutor['calls'] = { runLoop: [], attemptStructured: [], runStream: [] }
  const client: FakeExecutorClient = { kind: 'fake-executor-client' }

  const spec: ExecutorSpec<FakeExecutorClient, string, FakeRawResponse, FakeRawStream> = {
    executorId: 'fake',

    describeModel(model: string): ModelInfo {
      const idx = model.indexOf(':')
      if (idx > 0) return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) }
      return { provider: 'fake', modelId: model }
    },

    mapSettings(settings: GenerationSettings): Record<string, unknown> {
      return { ...settings }
    },

    async runLoop(_client, request): Promise<ExecutorOutcome<FakeRawResponse>> {
      calls.runLoop.push(request)
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
          await request.observer?.onStepFinish({
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

        const directive: StepDirective = (await request.observer?.onStepFinish({
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

    async attemptStructured(_client, request): Promise<StructuredAttempt<FakeRawResponse>> {
      calls.attemptStructured.push(request)
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

    async runStream(_client, request): Promise<ExecutorStreamHandle<FakeRawStream>> {
      calls.runStream.push(request)
      const scripted = streams.shift() ?? ['fake ', 'stream']

      // Drive the safety streaming sub-protocol exactly as a real spec
      // must: feed deltas, forward emits, swallow holds, append the seal's
      // pending tail. Blocks reject the stream.
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
          usage: {
            inputTokens: FAKE_USAGE.inputTokens,
            outputTokens: FAKE_USAGE.outputTokens,
            totalTokens: FAKE_USAGE.totalTokens,
          },
          finishReason: 'stop',
          streaming: { totalChunks: chunks.length, ttftMs: 1 },
        }),
      }
    },
  }

  return { spec, client, calls }
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

// ─────────────────────────────────────────────────────────────────
// executorSpecConformance
// ─────────────────────────────────────────────────────────────────

/**
 * How a conformance run programs "model behavior" for the spec under test.
 *
 * Each harness translates the abstract emission script into its SDK's
 * world: the fake executor consumes it directly; an AI SDK executor backs
 * it with `MockLanguageModelV3`. The returned client/model pair is used
 * for exactly one conformance case.
 */
export interface ExecutorConformanceHarness<TClient, TModel> {
  /**
   * Build a client + model whose "model" emits the given script: one entry
   * per loop step (text and/or tool calls), in order. For structured
   * cases, `structuredTexts` are the raw outputs of successive
   * `attemptStructured` calls.
   */
  prepare(script: {
    readonly emissions?: readonly FakeExecutorEmission[]
    readonly structuredTexts?: readonly string[]
  }): Promise<{ client: TClient; model: TModel }> | { client: TClient; model: TModel }
}

/** One failed conformance check. */
export interface ConformanceViolation {
  readonly rule: string
  readonly detail: string
}

function baseRequest<TClient, TModel>(
  spec: ExecutorSpec<TClient, TModel, unknown, unknown>,
  model: TModel,
  overrides: Partial<ExecutorRequest<TModel>>,
): ExecutorRequest<TModel> {
  return {
    model,
    modelInfo: spec.describeModel(model),
    system: 'You are a conformance test.',
    systemBlocks: undefined,
    prompt: 'run the conformance scenario',
    messages: undefined,
    settings: {},
    tools: undefined,
    activeTools: undefined,
    maxSteps: 10,
    observer: undefined,
    abortSignal: undefined,
    extra: undefined,
    ...overrides,
  }
}

/**
 * Run the executor contract suite against an `ExecutorSpec` implementation.
 *
 * Both `fakeExecutor()` and every real executor (e.g. `@crux/ai`'s
 * `AiSdkExecutor`) must pass — that shared bar is what lets policy tests
 * written against the fake transfer to production. Checks cover the
 * contract's subtle seams:
 *
 * 1. A no-tool response completes the loop in one step.
 * 2. Tool steps run to completion and report accurate step counts.
 * 3. `maxSteps` caps the loop.
 * 4. The observer sees steps in order with correct indexes; `stop` halts.
 * 5. `amend` + `refundStep` returns a step to the budget.
 * 6. Approval-needing tools suspend (without executing) with pending info.
 * 7. `attemptStructured` returns `invalid` as a value, and `ok` with the
 *    parsed object for valid output.
 *
 * @param spec - The executor implementation under test.
 * @param harness - SDK-specific scripting bridge; see
 *   {@link ExecutorConformanceHarness}.
 * @returns The list of violations — empty when the spec conforms. Assert
 *   `expect(violations).toEqual([])` so failures print the rule and detail.
 *
 * @example
 * ```ts
 * it('conforms to the ExecutorSpec contract', async () => {
 *   const violations = await executorSpecConformance(mySpec, myHarness)
 *   expect(violations).toEqual([])
 * })
 * ```
 */
export async function executorSpecConformance<TClient, TModel>(
  spec: ExecutorSpec<TClient, TModel, unknown, unknown>,
  harness: ExecutorConformanceHarness<TClient, TModel>,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = []
  const fail = (rule: string, detail: string) => violations.push({ rule, detail })
  // Conformance tools carry an `inputSchema` so they are valid for SDKs
  // (like the AI SDK) that validate tool definitions; in-memory specs
  // simply ignore it.
  const anyInput = z.record(z.string(), z.unknown())
  const echoTool = { description: 'echo', inputSchema: anyInput, execute: async (input: unknown) => input }

  // 1. No-tool response completes in one step.
  {
    const { client, model } = await harness.prepare({ emissions: [{ text: 'done' }] })
    const outcome = await spec.runLoop(client, baseRequest(spec, model, {}))
    if (outcome.status !== 'complete') fail('single-step completion', `expected complete, got ${outcome.status}`)
    else {
      if (outcome.steps !== 1) fail('single-step completion', `expected 1 step, got ${outcome.steps}`)
      if (outcome.response.text !== 'done')
        fail('single-step completion', `expected final text 'done', got '${outcome.response.text}'`)
    }
  }

  // 2 + 4. Tool loop runs to completion; observer sees ordered steps.
  {
    const { client, model } = await harness.prepare({
      emissions: [{ text: '', toolCalls: [{ name: 'echo', args: { v: 1 } }] }, { text: 'finished' }],
    })
    const seen: number[] = []
    const outcome = await spec.runLoop(
      client,
      baseRequest(spec, model, {
        tools: { echo: echoTool },
        observer: {
          onStepFinish: async (step) => {
            seen.push(step.index)
            return { kind: 'continue' }
          },
        },
      }),
    )
    if (outcome.status !== 'complete') fail('tool loop completion', `expected complete, got ${outcome.status}`)
    else if (outcome.steps !== 2) fail('tool loop completion', `expected 2 steps, got ${outcome.steps}`)
    if (seen.length === 0 || seen[0] !== 0 || seen.some((v, i) => i > 0 && v <= seen[i - 1]!)) {
      fail('observer ordering', `expected strictly increasing indexes from 0, saw [${seen.join(', ')}]`)
    }
  }

  // 3. maxSteps caps the loop.
  {
    const toolStep = { text: '', toolCalls: [{ name: 'echo', args: {} }] }
    const { client, model } = await harness.prepare({ emissions: [toolStep, toolStep, toolStep, { text: 'late' }] })
    const outcome = await spec.runLoop(client, baseRequest(spec, model, { tools: { echo: echoTool }, maxSteps: 2 }))
    if (outcome.status === 'complete' && outcome.steps > 2) {
      fail('maxSteps budget', `expected at most 2 steps, got ${outcome.steps}`)
    }
  }

  // 4b. `stop` directive halts the loop.
  {
    const toolStep = { text: 'stop here', toolCalls: [{ name: 'echo', args: {} }] }
    const { client, model } = await harness.prepare({ emissions: [toolStep, toolStep, { text: 'unreachable' }] })
    const outcome = await spec.runLoop(
      client,
      baseRequest(spec, model, {
        tools: { echo: echoTool },
        observer: { onStepFinish: async () => ({ kind: 'stop', reason: 'conformance' }) },
      }),
    )
    if (outcome.status !== 'complete') fail('stop directive', `expected complete, got ${outcome.status}`)
    else if (outcome.steps !== 1) fail('stop directive', `expected loop to stop after 1 step, got ${outcome.steps}`)
  }

  // 5. amend + refundStep returns the step to the budget.
  {
    const toolStep = { text: '', toolCalls: [{ name: 'echo', args: {} }] }
    const { client, model } = await harness.prepare({ emissions: [toolStep, toolStep, { text: 'end' }] })
    let refunded = false
    const outcome = await spec.runLoop(
      client,
      baseRequest(spec, model, {
        tools: { echo: echoTool },
        maxSteps: 2,
        observer: {
          onStepFinish: async () => {
            if (!refunded) {
              refunded = true
              return { kind: 'amend', refundStep: true }
            }
            return { kind: 'continue' }
          },
        },
      }),
    )
    if (outcome.status !== 'complete') fail('refundStep', `expected complete, got ${outcome.status}`)
    else if (outcome.steps !== 2) {
      fail('refundStep', `expected 2 budget-consuming steps after one refund, got ${outcome.steps}`)
    }
  }

  // 6. Approval-needing tool suspends without executing.
  {
    let executed = false
    const { client, model } = await harness.prepare({
      emissions: [{ text: 'requesting', toolCalls: [{ name: 'guarded', args: { go: true } }] }],
    })
    const outcome = await spec.runLoop(
      client,
      baseRequest(spec, model, {
        tools: {
          guarded: {
            description: 'guarded',
            inputSchema: anyInput,
            needsApproval: true,
            execute: async () => {
              executed = true
              return 'ran'
            },
          },
        },
      }),
    )
    if (outcome.status !== 'suspended') fail('approval suspension', `expected suspended, got ${outcome.status}`)
    else {
      if (executed) fail('approval suspension', 'tool executed despite needing approval')
      if (outcome.pendingApprovals[0]?.toolName !== 'guarded') {
        fail(
          'approval suspension',
          `expected pending approval for 'guarded', got '${outcome.pendingApprovals[0]?.toolName}'`,
        )
      }
    }
  }

  // 7. attemptStructured: invalid is a value; valid yields the object.
  {
    const schema = z.object({ ok: z.boolean() })
    const { client, model } = await harness.prepare({ structuredTexts: ['definitely not json'] })
    try {
      const attempt = await spec.attemptStructured(client, {
        ...baseRequest(spec, model, {}),
        schema,
      })
      if (attempt.status !== 'invalid') fail('structured invalid-as-value', `expected invalid, got ${attempt.status}`)
    } catch (error) {
      fail('structured invalid-as-value', `attemptStructured threw on invalid output: ${String(error)}`)
    }

    const valid = await harness.prepare({ structuredTexts: ['{"ok":true}'] })
    const attempt = await spec.attemptStructured(valid.client, {
      ...baseRequest(spec, valid.model, { model: valid.model }),
      schema,
    })
    if (attempt.status !== 'ok') fail('structured ok', `expected ok, got ${attempt.status}`)
    else if (JSON.stringify(attempt.object) !== '{"ok":true}') {
      fail('structured ok', `expected parsed object {"ok":true}, got ${JSON.stringify(attempt.object)}`)
    }
  }

  return violations
}
