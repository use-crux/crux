/**
 * Flow executor — runs flow eval steps sequentially, handling plain prompt
 * generation, tool-calling loops, and multiturn conversations.
 *
 * @module
 */

import { generateText, tool as aiTool, stepCountIs } from 'ai'
import type { LanguageModel, ToolSet, ModelMessage } from 'ai'
import type { z } from 'zod'
import type { Context, MergedInput } from '../types'
import type {
  FlowStepDef,
  FlowEvalCase,
  FlowModelConfig,
  FlowTrace,
  FlowStepResult,
  FlowStepContext,
  FlowToolCall,
  FlowTurnResult,
  FlowToolDef,
  ToolMocks,
  EvalTokenUsage,
  GenerateFn,
} from '../testing'

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Sum token usage from multiple sources. */
function sumUsage(...usages: (EvalTokenUsage | undefined)[]): EvalTokenUsage {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  for (const u of usages) {
    if (!u) continue
    inputTokens += u.inputTokens ?? 0
    outputTokens += u.outputTokens ?? 0
    totalTokens += u.totalTokens ?? 0
  }
  return { inputTokens, outputTokens, totalTokens }
}

/** Minimal structural shape of generate-result values inspected here. */
interface FlowGenerateResult {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  _meta?: { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; cost?: number }
}

/** Extract token usage from an AI SDK result. */
function extractUsage(result: FlowGenerateResult | undefined): EvalTokenUsage | undefined {
  const u = result?.usage ?? result?._meta?.usage
  if (!u) return undefined
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    totalTokens: u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
  }
}

/** Extract cost from an AI SDK result. */
function extractCost(result: FlowGenerateResult | undefined): number | undefined {
  return result?._meta?.cost ?? undefined
}

/**
 * Build AI SDK tools from flow tool definitions and mocks.
 *
 * Each tool gets the Zod schema for its parameters and an execute function
 * that resolves the mock (static value or function).
 */
/**
 * Parsed args captured from tool execute() calls.
 * The AI SDK calls execute() with Zod-validated/defaulted args,
 * while step.toolCalls contains raw model JSON without defaults.
 */
type ParsedArgsCapture = {
  toolName: string
  toolCallId: string
  args: Record<string, unknown>
}[]

function buildToolSet(tools: FlowToolDef[], mocks: ToolMocks, parsedArgs: ParsedArgsCapture): ToolSet {
  const toolSet: Record<string, unknown> = {}
  for (const def of tools) {
    const mock = mocks[def.name]
    toolSet[def.name] = aiTool({
      description: def.description,
      inputSchema: def.parameters,
      execute: async (args: unknown, opts: { toolCallId: string }) => {
        const safeArgs = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
        // Capture the Zod-parsed args (with defaults applied)
        parsedArgs.push({ toolName: def.name, toolCallId: opts.toolCallId, args: { ...safeArgs } })
        if (typeof mock === 'function') {
          return await (mock as (args: Record<string, unknown>) => unknown)(safeArgs)
        }
        return mock
      },
    })
  }
  return toolSet as ToolSet
}

/**
 * Extract tool calls from AI SDK generateText steps.
 *
 * Uses captured parsed args from execute() calls (which have Zod defaults
 * applied) instead of the raw step.toolCalls args.
 */
interface FlowSdkStep {
  toolCalls?: Array<{ toolCallId: string; toolName: string; args?: unknown }>
  toolResults?: Array<{ result?: unknown }>
}

function extractToolCallsFromSteps(steps: FlowSdkStep[], parsedArgs?: ParsedArgsCapture): FlowToolCall[] {
  // Index captured args by toolCallId for fast lookup
  const parsedById = new Map<string, Record<string, unknown>>()
  if (parsedArgs) {
    for (const pa of parsedArgs) {
      parsedById.set(pa.toolCallId, pa.args)
    }
  }

  const calls: FlowToolCall[] = []
  for (const step of steps) {
    if (step.toolCalls) {
      for (let i = 0; i < step.toolCalls.length; i++) {
        const tc = step.toolCalls[i]!
        const tr = step.toolResults?.[i]
        // Prefer captured parsed args (with Zod defaults) over raw model args
        const rawArgs = tc.args && typeof tc.args === 'object' ? (tc.args as Record<string, unknown>) : {}
        const args: Record<string, unknown> = parsedById.get(tc.toolCallId) ?? rawArgs
        calls.push({
          name: tc.toolName,
          args,
          result: tr?.result,
        })
      }
    }
  }
  return calls
}

/** Create a FlowStepContext for step input/skip functions. */
function createStepContext(evalCase: FlowEvalCase, completedSteps: Record<string, FlowStepResult>): FlowStepContext {
  return {
    case: evalCase,
    step(id: string): FlowStepResult {
      const result = completedSteps[id]
      if (!result) {
        throw new Error(`Flow step "${id}" has not been executed yet.`)
      }
      return result
    },
  }
}

/** Create a FlowTrace from completed step results. */
function createFlowTrace(
  configName: string,
  stepResults: Record<string, FlowStepResult>,
  durationMs: number,
  error?: string,
): FlowTrace {
  // Aggregate usage and cost
  let totalUsage: EvalTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }
  let totalCost = 0
  for (const result of Object.values(stepResults)) {
    if (result.skipped) continue
    totalUsage = sumUsage(totalUsage, result.usage)
    totalCost += result.cost ?? 0
  }

  return {
    configName,
    stepResults,
    step(id: string): FlowStepResult {
      const result = stepResults[id]
      if (!result) {
        throw new Error(`Flow step "${id}" does not exist. Available: ${Object.keys(stepResults).join(', ')}`)
      }
      return result
    },
    durationMs,
    totalUsage,
    totalCost,
    error,
  }
}

// ─────────────────────────────────────────────────────────────────
// Executor Options
// ─────────────────────────────────────────────────────────────────

export interface ExecuteFlowOptions {
  /** Steps to execute in order. */
  steps: FlowStepDef[]
  /** The test case being executed. */
  evalCase: FlowEvalCase
  /** The model configuration to use. */
  config: FlowModelConfig
  /**
   * Generate function from an adapter (e.g., `generate` from `@crux/ai`).
   * Used for plain steps (no tools).
   */
  generate: GenerateFn
  /** Per-step timeout in ms. */
  timeout?: number
}

// ─────────────────────────────────────────────────────────────────
// Plain Step Execution
// ─────────────────────────────────────────────────────────────────

async function executePlainStep(
  step: FlowStepDef,
  input: Record<string, unknown>,
  model: unknown,
  generate: GenerateFn,
  timeout?: number,
): Promise<FlowStepResult> {
  const start = Date.now()
  try {
    // Flow steps carry `AnyPrompt` (`readonly ContextEntry[]`); adapter
    // `generate` narrows to `readonly Context<z.ZodType>[]`. Cast is local —
    // resolved contexts match either constraint.
    const generateCall = generate(step.prompt as unknown as Parameters<GenerateFn>[0], { model, input })
    const rawResult = timeout
      ? await Promise.race([
          generateCall,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Step "${step.id}" timed out after ${timeout}ms`)), timeout),
          ),
        ])
      : await generateCall
    // `GenerateFn` returns `Promise<unknown>` (adapter bridge); narrow to the
    // generate-result shape this step extracts (text/object/usage/cost).
    const result = rawResult as FlowGenerateResult & { object?: unknown; text?: string }

    return {
      id: step.id,
      output: result.object ?? result.text ?? result,
      text: result.text,
      skipped: false,
      durationMs: Date.now() - start,
      usage: extractUsage(result),
      cost: extractCost(result),
      input,
    }
  } catch (err) {
    throw new Error(`Step "${step.id}" failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─────────────────────────────────────────────────────────────────
// Tool-Calling Step Execution (Single-Turn)
// ─────────────────────────────────────────────────────────────────

async function executeToolCallStep(
  step: FlowStepDef,
  input: Record<string, unknown>,
  model: unknown,
  timeout?: number,
): Promise<FlowStepResult> {
  const start = Date.now()
  const tools = step.tools ?? []
  const mocks = step.toolMocks ?? {}
  const maxSteps = step.maxToolSteps ?? 15

  // Capture Zod-parsed args from execute() calls
  const parsedArgs: ParsedArgsCapture = []

  // Resolve the prompt to get the system message
  type FlowResolveOpts = Parameters<typeof step.prompt.resolve>[0]
  const resolved = await step.prompt.resolve({ input } as unknown as FlowResolveOpts)
  const toolSet = buildToolSet(tools, mocks, parsedArgs)

  const messages: ModelMessage[] = []
  if (resolved.prompt) {
    messages.push({ role: 'user', content: resolved.prompt })
  } else if (input.userMessage) {
    messages.push({ role: 'user', content: String(input.userMessage) })
  }

  try {
    const generateCall = generateText({
      model: model as LanguageModel,
      system: resolved.system,
      messages,
      tools: toolSet,
      stopWhen: stepCountIs(maxSteps),
    })
    const result = timeout
      ? await Promise.race([
          generateCall,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Step "${step.id}" timed out after ${timeout}ms`)), timeout),
          ),
        ])
      : await generateCall

    const toolCalls = extractToolCallsFromSteps(result.steps as unknown as FlowSdkStep[], parsedArgs)
    const usage = result.usage
      ? {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
        }
      : undefined

    return {
      id: step.id,
      output: result.text,
      text: result.text,
      skipped: false,
      durationMs: Date.now() - start,
      usage,
      toolCalls,
      toolStepCount: result.steps.length,
      input,
    }
  } catch (err) {
    throw new Error(`Step "${step.id}" failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─────────────────────────────────────────────────────────────────
// Tool-Calling Step Execution (Multiturn)
// ─────────────────────────────────────────────────────────────────

async function executeMultiturnStep(
  step: FlowStepDef,
  evalCase: FlowEvalCase,
  model: unknown,
  completedSteps: Record<string, FlowStepResult>,
  timeout?: number,
): Promise<FlowStepResult> {
  const start = Date.now()
  const turns = evalCase.turns!
  const tools = step.tools ?? []
  const mocks = step.toolMocks ?? {}
  const maxSteps = step.maxToolSteps ?? 15

  // Capture Zod-parsed args from execute() calls
  const parsedArgs: ParsedArgsCapture = []

  // Resolve prompt for system message
  type FlowResolveOpts = Parameters<typeof step.prompt.resolve>[0]
  const resolved = await step.prompt.resolve({} as unknown as FlowResolveOpts)
  const toolSet = buildToolSet(tools, mocks, parsedArgs)

  // Accumulate conversation messages across turns
  const conversationHistory: ModelMessage[] = []

  // Add context messages if provided
  if (evalCase.contextMessages) {
    for (const cm of evalCase.contextMessages) {
      conversationHistory.push({ role: cm.role, content: cm.content } as ModelMessage)
    }
  }

  const turnResults: FlowTurnResult[] = []
  const allToolCalls: FlowToolCall[] = []
  let totalToolStepCount = 0
  let aggregateUsage: EvalTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }
  let aggregateCost = 0

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    const turnStart = Date.now()

    // Add user message
    conversationHistory.push({ role: 'user', content: turn.userMessage })

    try {
      const generateCall = generateText({
        model: model as LanguageModel,
        system: resolved.system,
        messages: [...conversationHistory],
        tools: toolSet,
        stopWhen: stepCountIs(maxSteps),
      })
      const result = timeout
        ? await Promise.race([
            generateCall,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Turn ${i} of step "${step.id}" timed out after ${timeout}ms`)),
                timeout,
              ),
            ),
          ])
        : await generateCall

      const turnToolCalls = extractToolCallsFromSteps(result.steps as unknown as FlowSdkStep[], parsedArgs)
      const turnUsage = result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          }
        : undefined

      const turnResult: FlowTurnResult = {
        userMessage: turn.userMessage,
        response: result.text,
        toolCalls: turnToolCalls,
        toolStepCount: result.steps.length,
        usage: turnUsage,
        durationMs: Date.now() - turnStart,
      }
      turnResults.push(turnResult)
      allToolCalls.push(...turnToolCalls)
      totalToolStepCount += result.steps.length
      aggregateUsage = sumUsage(aggregateUsage, turnUsage)

      // Add assistant response to conversation history for next turn
      conversationHistory.push({ role: 'assistant', content: result.text })

      // Build the partial step result for intermediate assertions
      // Snapshot arrays to avoid reference mutation affecting captured traces
      const partialStepResult: FlowStepResult = {
        id: step.id,
        output: result.text,
        text: result.text,
        skipped: false,
        durationMs: Date.now() - start,
        usage: { ...aggregateUsage },
        toolCalls: [...allToolCalls],
        turns: [...turnResults],
        turnCount: turnResults.length,
        totalToolStepCount,
      }
      const partialSteps = { ...completedSteps, [step.id]: partialStepResult }

      // Run intermediate assertion if defined
      if (turn.assert) {
        const trace = createFlowTrace(
          '', // config name not important for intermediate assertions
          partialSteps,
          Date.now() - start,
        )
        const passed = await turn.assert(trace)
        if (passed === false) {
          throw new Error(`Intermediate assertion failed for turn ${i}: "${turn.userMessage}"`)
        }
      }
    } catch (err) {
      throw new Error(`Turn ${i} of step "${step.id}" failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    id: step.id,
    output: turnResults[turnResults.length - 1]?.response ?? '',
    text: turnResults[turnResults.length - 1]?.response,
    skipped: false,
    durationMs: Date.now() - start,
    usage: aggregateUsage,
    cost: aggregateCost,
    toolCalls: allToolCalls,
    turns: turnResults,
    turnCount: turnResults.length,
    totalToolStepCount,
    input: evalCase.input ?? {},
  }
}

// ─────────────────────────────────────────────────────────────────
// Main Executor
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a flow for a single (case, config) pair.
 *
 * Iterates through steps in order:
 * - **Plain steps** (no tools): Calls `generate()` from the adapter.
 * - **Tool-calling steps** (with tools, single-turn): Calls `generateText()`
 *   with mock tool implementations and `maxSteps`.
 * - **Multiturn steps** (with tools and `turns`): Runs multiple `generateText()`
 *   calls with accumulated conversation history.
 *
 * @returns A `FlowTrace` with all step results, ready for assertions.
 */
export async function executeFlow(options: ExecuteFlowOptions): Promise<FlowTrace> {
  const { steps, evalCase, config, generate, timeout } = options
  const start = Date.now()
  const completedSteps: Record<string, FlowStepResult> = {}

  try {
    for (const step of steps) {
      const ctx = createStepContext(evalCase, completedSteps)
      const model = config.models[step.id]
      if (!model) {
        throw new Error(
          `No model configured for step "${step.id}" in config "${config.name}". ` +
            `Available: ${Object.keys(config.models).join(', ')}`,
        )
      }

      // Check skip predicate
      if (step.skip?.(ctx)) {
        completedSteps[step.id] = {
          id: step.id,
          output: undefined,
          skipped: true,
          durationMs: 0,
        }
        continue
      }

      const isToolStep = step.tools && step.tools.length > 0
      const isMultiturn = evalCase.turns && evalCase.turns.length > 0

      if (isToolStep && isMultiturn) {
        // Multiturn tool-calling step
        completedSteps[step.id] = await executeMultiturnStep(step, evalCase, model, completedSteps, timeout)
      } else if (isToolStep) {
        // Single-turn tool-calling step
        const input = step.input ? step.input(ctx) : (evalCase.input ?? {})
        completedSteps[step.id] = await executeToolCallStep(step, input, model, timeout)
      } else {
        // Plain step (structured or text)
        const input = step.input ? step.input(ctx) : (evalCase.input ?? {})
        completedSteps[step.id] = await executePlainStep(step, input, model, generate, timeout)
      }

      // Run per-step tool call assertions if configured
      if (step.assertToolCalls && completedSteps[step.id] && !completedSteps[step.id].skipped) {
        const toolCalls = completedSteps[step.id].toolCalls ?? []
        const assertResult = await step.assertToolCalls(toolCalls)
        if (assertResult === false) {
          throw new Error(`Step "${step.id}" assertToolCalls failed`)
        }
      }
    }

    return createFlowTrace(config.name, completedSteps, Date.now() - start)
  } catch (err) {
    return createFlowTrace(
      config.name,
      completedSteps,
      Date.now() - start,
      err instanceof Error ? err.message : String(err),
    )
  }
}
