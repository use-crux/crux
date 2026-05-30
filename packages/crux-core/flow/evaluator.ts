/**
 * Flow evaluator — runs flow evals across a case × config matrix
 * with concurrency control and reporting.
 *
 * @module
 */

import type {
  FlowEvalDef,
  FlowEvalCase,
  FlowModelConfig,
  FlowEvalCaseResult,
  FlowEvalReport,
  FlowTrace,
  FlowStepSummary,
  GenerateFn,
  EvalTokenUsage,
} from '../testing'
import { getRuntime } from '../runtime'
import { executeFlow } from './executor'

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let flowCounter = 0

function generateFlowId(): string {
  flowCounter++
  return `flow-${Date.now()}-${flowCounter}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Extract a useful error message from errors.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Extract a model ID string from a model value (string or SDK model object). */
function extractModelId(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const id = (model as { modelId?: unknown }).modelId
    if (typeof id === 'string') return id
  }
  return 'unknown'
}

// ─────────────────────────────────────────────────────────────────
// Evaluator Options
// ─────────────────────────────────────────────────────────────────

export interface EvaluateFlowOptions {
  /** The flow eval definition. */
  flowEval: FlowEvalDef
  /** Generate function from an adapter (for plain steps). */
  generate: GenerateFn
  /** Per-case timeout in ms. */
  timeout?: number
  /** Maximum concurrent (case, config) executions. Overrides flow eval's concurrency. */
  concurrency?: number
  /** Progress callback fired after each (case, config) completes. */
  onCaseComplete?: (result: FlowEvalCaseResult) => void
}

// ─────────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────────

/**
 * Run a flow eval across a matrix of cases and model configs.
 *
 * For each (case, config) pair:
 * 1. Execute the flow (all steps in order)
 * 2. Run the case's final assertion against the flow trace
 * 3. Record the result
 *
 * Reports progress via the global `FlowEvalReporter` (set by devtools).
 *
 * @returns A `FlowEvalReport` with per-case results and aggregated summary.
 */
export async function evaluateFlow(options: EvaluateFlowOptions): Promise<FlowEvalReport> {
  const { flowEval, generate, onCaseComplete } = options
  const concurrency = options.concurrency ?? flowEval.concurrency ?? 3
  const timeout = options.timeout ?? flowEval.timeout
  const reporter = getRuntime().flowEvalReporter
  const flowId = generateFlowId()
  const evalStart = Date.now()

  // Build the (case, config) work matrix
  const work: Array<{ evalCase: FlowEvalCase; config: FlowModelConfig }> = []
  for (const config of flowEval.configs) {
    for (const evalCase of flowEval.cases) {
      work.push({ evalCase, config })
    }
  }

  // Notify reporter
  reporter?.onStart({
    flowId,
    name: flowEval.name,
    description: flowEval.description,
    stepIds: flowEval.steps.map((s) => s.id),
    configNames: flowEval.configs.map((c) => c.name),
    caseNames: flowEval.cases.map((c) => c.name),
    totalCases: work.length,
  })

  const results: FlowEvalCaseResult[] = []
  let idx = 0
  let completedCount = 0

  async function worker(): Promise<void> {
    while (idx < work.length) {
      const item = work[idx++]
      const start = Date.now()
      let passed = false
      let error: string | undefined
      let trace: FlowTrace

      try {
        // Execute the flow
        trace = await executeFlow({
          steps: flowEval.steps,
          evalCase: item.evalCase,
          config: item.config,
          generate,
          timeout,
        })

        // Check if the flow itself had an error
        if (trace.error) {
          throw new Error(trace.error)
        }

        // Run the final assertion
        passed = await item.evalCase.assert(trace)
      } catch (err) {
        passed = false
        error = extractErrorMessage(err)
        // If trace wasn't created (unlikely), create a minimal one
        trace ??= {
          configName: item.config.name,
          stepResults: {},
          step: () => {
            throw new Error('No steps completed')
          },
          durationMs: Date.now() - start,
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          totalCost: 0,
          error: error,
        }
      }

      const caseResult: FlowEvalCaseResult = {
        caseName: item.evalCase.name,
        configName: item.config.name,
        passed,
        durationMs: Date.now() - start,
        error,
        trace: trace!,
      }
      results.push(caseResult)
      completedCount++

      onCaseComplete?.(caseResult)

      // Report to devtools — build rich per-step summaries
      const steps: FlowStepSummary[] = Object.values(trace!.stepResults).map((sr) => {
        const modelId = extractModelId(item.config.models[sr.id])
        return {
          id: sr.id,
          modelId,
          durationMs: sr.durationMs,
          inputTokens: sr.usage?.inputTokens ?? 0,
          outputTokens: sr.usage?.outputTokens ?? 0,
          totalTokens: sr.usage?.totalTokens ?? 0,
          cost: sr.cost ?? 0,
          skipped: sr.skipped,
          toolCalls: (sr.toolCalls ?? []).map((tc) => ({
            name: tc.name,
            args: tc.args,
            result: tc.result,
          })),
          input: sr.input,
          output: sr.output,
          text: sr.text,
          turns: sr.turns?.map((t) => ({
            userMessage: t.userMessage,
            response: t.response,
            toolCalls: t.toolCalls.map((tc) => ({
              name: tc.name,
              args: tc.args,
              result: tc.result,
            })),
            durationMs: t.durationMs,
            inputTokens: t.usage?.inputTokens ?? 0,
            outputTokens: t.usage?.outputTokens ?? 0,
          })),
        }
      })

      reporter?.onCase({
        flowId,
        caseName: item.evalCase.name,
        configName: item.config.name,
        passed,
        durationMs: caseResult.durationMs,
        error,
        completedCount,
        traceSummary: {
          stepCount: Object.keys(trace!.stepResults).length,
          toolCallNames: Object.values(trace!.stepResults).flatMap((s) => (s.toolCalls ?? []).map((tc) => tc.name)),
          totalTokens: trace!.totalUsage.totalTokens ?? 0,
          totalCost: trace!.totalCost,
          steps,
        },
      })
    }
  }

  // Run with concurrency
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, () => worker())
  await Promise.all(workers)

  // Aggregate summary
  const byConfig: Record<string, { total: number; passed: number; failed: number }> = {}
  let totalSteps = 0
  let totalTokens = 0
  let totalCost = 0

  for (const r of results) {
    if (!byConfig[r.configName]) {
      byConfig[r.configName] = { total: 0, passed: 0, failed: 0 }
    }
    byConfig[r.configName].total++
    if (r.passed) byConfig[r.configName].passed++
    else byConfig[r.configName].failed++

    totalSteps += Object.keys(r.trace.stepResults).length
    totalTokens += r.trace.totalUsage.totalTokens ?? 0
    totalCost += r.trace.totalCost
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    byConfig,
    totalSteps,
    avgSteps: results.length > 0 ? totalSteps / results.length : 0,
    totalTokens,
    totalCost,
  }

  // Report completion
  reporter?.onEnd({
    flowId,
    durationMs: Date.now() - evalStart,
    summary,
  })

  return { name: flowEval.name, results, summary }
}
