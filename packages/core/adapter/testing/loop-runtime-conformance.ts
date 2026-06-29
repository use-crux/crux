/**
 * `loopRuntimePortConformance()` — the lower-level contract suite for
 * {@link LoopRuntimePort} implementations.
 *
 * Both `fakeLoopRuntime()` and every real runtime (e.g. `@use-crux/ai`'s
 * `createAiSdkLoopRuntime()`) must pass it — that shared bar is what lets
 * policy tests written against the fake transfer to production.
 *
 * @module
 */

import { z } from 'zod'
import type { LoopRuntimePort } from '../loop-runtime-port'
import type { ExecutorRequest } from '../executor-types'
import type { FakeLoopEmission } from './fake-loop-runtime'

/**
 * How a conformance run programs "model behavior" for the runtime under test.
 *
 * Each harness translates the abstract emission script into its SDK's world:
 * the fake runtime consumes it directly; an AI SDK runtime backs it with
 * `MockLanguageModelV3`. Each `prepare()` returns a freshly-bound runtime plus
 * the model that drives it, used for exactly one conformance case.
 */
export interface LoopRuntimeConformanceHarness<TModel> {
  /**
   * Build a runtime + model whose "model" emits the given script: one entry
   * per loop step (text and/or tool calls), in order. For structured cases,
   * `structuredTexts` are the raw outputs of successive
   * `runStructuredAttempt` calls.
   */
  prepare(script: {
    readonly emissions?: readonly FakeLoopEmission[]
    readonly structuredTexts?: readonly string[]
  }):
    | Promise<{ runtime: LoopRuntimePort<TModel>; model: TModel }>
    | { runtime: LoopRuntimePort<TModel>; model: TModel }
}

/** One failed conformance check. */
export interface ConformanceViolation {
  readonly rule: string
  readonly detail: string
}

function baseRequest<TModel>(
  runtime: LoopRuntimePort<TModel>,
  model: TModel,
  overrides: Partial<ExecutorRequest<TModel>>,
): ExecutorRequest<TModel> {
  return {
    model,
    modelInfo: runtime.describeModel(model),
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
 * Run the loop runtime contract suite against a {@link LoopRuntimePort}
 * implementation. Checks cover the contract's subtle seams:
 *
 * 1. A no-tool response completes the loop in one step.
 * 2. Tool steps run to completion and report accurate step counts.
 * 3. `maxSteps` caps the loop.
 * 4. The observer sees steps in order with correct indexes; `stop` halts.
 * 5. `amend` + `refundStep` returns a step to the budget.
 * 6. Approval-needing tools suspend (without executing) with pending info.
 * 7. `runStructuredAttempt` returns `invalid` as a value, and `ok` with the
 *    parsed object for valid output.
 *
 * @param harness - SDK-specific scripting bridge; see
 *   {@link LoopRuntimeConformanceHarness}.
 * @returns The list of violations — empty when the runtime conforms. Assert
 *   `expect(violations).toEqual([])` so failures print the rule and detail.
 *
 * @example
 * ```ts
 * it('conforms to the LoopRuntimePort contract', async () => {
 *   const violations = await loopRuntimePortConformance(myHarness)
 *   expect(violations).toEqual([])
 * })
 * ```
 */
export async function loopRuntimePortConformance<TModel>(
  harness: LoopRuntimeConformanceHarness<TModel>,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = []
  const fail = (rule: string, detail: string) => violations.push({ rule, detail })
  // Conformance tools carry an `inputSchema` so they are valid for SDKs
  // (like the AI SDK) that validate tool definitions; in-memory runtimes
  // simply ignore it.
  const anyInput = z.record(z.string(), z.unknown())
  const echoTool = { description: 'echo', inputSchema: anyInput, execute: async (input: unknown) => input }

  // 1. No-tool response completes in one step.
  {
    const { runtime, model } = await harness.prepare({ emissions: [{ text: 'done' }] })
    const outcome = await runtime.runTextLoop(baseRequest(runtime, model, {}))
    if (outcome.status !== 'complete') fail('single-step completion', `expected complete, got ${outcome.status}`)
    else {
      if (outcome.steps !== 1) fail('single-step completion', `expected 1 step, got ${outcome.steps}`)
      if (outcome.response.text !== 'done')
        fail('single-step completion', `expected final text 'done', got '${outcome.response.text}'`)
    }
  }

  // 2 + 4. Tool loop runs to completion; observer sees ordered steps.
  {
    const { runtime, model } = await harness.prepare({
      emissions: [{ text: '', toolCalls: [{ name: 'echo', args: { v: 1 } }] }, { text: 'finished' }],
    })
    const seen: number[] = []
    const outcome = await runtime.runTextLoop(
      baseRequest(runtime, model, {
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
    const { runtime, model } = await harness.prepare({ emissions: [toolStep, toolStep, toolStep, { text: 'late' }] })
    const outcome = await runtime.runTextLoop(baseRequest(runtime, model, { tools: { echo: echoTool }, maxSteps: 2 }))
    if (outcome.status === 'complete' && outcome.steps > 2) {
      fail('maxSteps budget', `expected at most 2 steps, got ${outcome.steps}`)
    }
  }

  // 4b. `stop` directive halts the loop.
  {
    const toolStep = { text: 'stop here', toolCalls: [{ name: 'echo', args: {} }] }
    const { runtime, model } = await harness.prepare({ emissions: [toolStep, toolStep, { text: 'unreachable' }] })
    const outcome = await runtime.runTextLoop(
      baseRequest(runtime, model, {
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
    const { runtime, model } = await harness.prepare({ emissions: [toolStep, toolStep, { text: 'end' }] })
    let refunded = false
    const outcome = await runtime.runTextLoop(
      baseRequest(runtime, model, {
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
    else {
      if (outcome.steps !== 2) {
        fail('refundStep', `expected 2 budget-consuming steps after one refund, got ${outcome.steps}`)
      }
      // The refund must actually unlock a third model step: the final response
      // is the third emission, not the second tool step.
      if (outcome.response.text !== 'end') {
        fail('refundStep', `expected final text 'end' once the refund unlocked a third step, got '${outcome.response.text}'`)
      }
    }
  }

  // 6. Approval-needing tool suspends without executing.
  {
    let executed = false
    const { runtime, model } = await harness.prepare({
      emissions: [{ text: 'requesting', toolCalls: [{ name: 'guarded', args: { go: true } }] }],
    })
    const outcome = await runtime.runTextLoop(
      baseRequest(runtime, model, {
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
      // Suspended-history contract: the approval-requesting assistant step must
      // not be committed to `messages` — it is held in `assistantResponse` so a
      // resume can re-issue or drop it.
      if (outcome.messages.some((message) => message.role === 'assistant')) {
        fail('approval suspension', 'suspended messages must not include the approval-requesting assistant step')
      }
      if (outcome.assistantResponse.text !== 'requesting') {
        fail(
          'approval suspension',
          `expected assistantResponse to preserve the requesting step, got '${outcome.assistantResponse.text}'`,
        )
      }
    }
  }

  // 7. runStructuredAttempt: invalid is a value; valid yields the object.
  {
    const schema = z.object({ ok: z.boolean() })
    const { runtime, model } = await harness.prepare({ structuredTexts: ['definitely not json'] })
    try {
      const attempt = await runtime.runStructuredAttempt({
        ...baseRequest(runtime, model, {}),
        schema,
      })
      if (attempt.status !== 'invalid') fail('structured invalid-as-value', `expected invalid, got ${attempt.status}`)
    } catch (error) {
      fail('structured invalid-as-value', `runStructuredAttempt threw on invalid output: ${String(error)}`)
    }

    const valid = await harness.prepare({ structuredTexts: ['{"ok":true}'] })
    const attempt = await valid.runtime.runStructuredAttempt({
      ...baseRequest(valid.runtime, valid.model, {}),
      schema,
    })
    if (attempt.status !== 'ok') fail('structured ok', `expected ok, got ${attempt.status}`)
    else if (JSON.stringify(attempt.object) !== '{"ok":true}') {
      fail('structured ok', `expected parsed object {"ok":true}, got ${JSON.stringify(attempt.object)}`)
    }
  }

  return violations
}
