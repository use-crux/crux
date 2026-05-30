/**
 * Eval orchestrator — runs evals and yields progress events.
 *
 * @module
 */

import {
  evaluatePrompt,
  evaluateRag,
  type EvalDef,
  type EvalReport,
  type FlowEvalReport,
  type FlowEvalCaseResult,
  type RagEvalReport,
  type EvalRunnerConfig,
} from '@crux/core/testing'
import { evaluateFlow } from '@crux/core/flow'
import type { DiscoveredEval, DiscoveredFlowEval, DiscoveredRagEval } from './eval-discovery'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface RunResult {
  name: string
  report?: EvalReport
  error?: string
  durationMs: number
  caseCount: number
}

export interface ModelStats {
  passed: number
  failed: number
  tokens: number
  cost: number
  durationMs: number
}

export interface EvalSummary {
  totalPassed: number
  totalFailed: number
  totalTokens: number
  totalCost: number
  byModel: Record<string, ModelStats>
  exitCode: number
}

export interface EvalProgress {
  type: 'eval:start' | 'eval:done'
  name: string
  index: number
  total: number
  result?: RunResult
}

// ── Flow Eval Types ──────────────────────────────────────────────

export interface FlowRunResult {
  name: string
  report?: FlowEvalReport
  error?: string
  durationMs: number
  caseCount: number
  configCount: number
}

export interface FlowProgress {
  type: 'flow:start' | 'flow:done' | 'flow:case'
  name: string
  index: number
  total: number
  result?: FlowRunResult
  /** Individual case completion — streamed as each (case, config) finishes. */
  caseResult?: FlowEvalCaseResult
}

export interface RagRunResult {
  name: string
  report?: RagEvalReport
  failedCases?: ReturnType<RagEvalReport['exportFailedCases']>
  error?: string
  durationMs: number
  caseCount: number
}

export interface RagProgress {
  type: 'rag:start' | 'rag:done'
  name: string
  index: number
  total: number
  result?: RagRunResult
}

// ─────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────

/**
 * Run a single eval and return the result.
 */
export async function runOne(
  entry: DiscoveredEval,
  models: unknown[],
  generate: EvalRunnerConfig['generate'],
  timeout?: number,
): Promise<RunResult> {
  const start = Date.now()
  try {
    // `EvalDef.prompt` is `AnyPrompt` and `EvalDef.cases` is loosely typed
    // (`EvalCase<Record<string, unknown>, EvalResult>`); `evaluatePrompt`'s
    // generics expect the cases' input/result types to match the prompt's
    // schemas. We can't infer that link from the discovered eval at this
    // boundary, so we cast through a `EvalOptions` shape.
    const report = await evaluatePrompt({
      prompt: entry.def.prompt,
      generate,
      models,
      cases: entry.def.cases,
      timeout,
    } as Parameters<typeof evaluatePrompt>[0])
    return {
      name: entry.name,
      report,
      durationMs: Date.now() - start,
      caseCount: entry.def.cases.length,
    }
  } catch (err) {
    return {
      name: entry.name,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
      caseCount: entry.def.cases.length,
    }
  }
}

/**
 * Run all evals with concurrency control, calling `onProgress` for each start/completion.
 */
export async function runAllEvals(opts: {
  evals: DiscoveredEval[]
  config: EvalRunnerConfig
  onProgress?: (event: EvalProgress) => void
}): Promise<RunResult[]> {
  const { evals, config, onProgress } = opts
  const concurrency = config.concurrency ?? 5
  const timeout = config.timeout ?? 60_000
  const results: RunResult[] = []
  let idx = 0
  let completedCount = 0

  async function worker() {
    while (idx < evals.length) {
      const currentIdx = idx++
      const entry = evals[currentIdx]
      const models = config.models[entry.def.mode]

      onProgress?.({
        type: 'eval:start',
        name: entry.name,
        index: currentIdx,
        total: evals.length,
      })

      const result = await runOne(entry, models, config.generate, timeout)
      results.push(result)
      completedCount++

      onProgress?.({
        type: 'eval:done',
        name: entry.name,
        index: currentIdx,
        total: evals.length,
        result,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, evals.length) }, () => worker()))

  return results
}

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────

/**
 * Compute aggregate summary from eval results.
 */
export function computeSummary(results: RunResult[]): EvalSummary {
  let totalPassed = 0
  let totalFailed = 0
  let totalTokens = 0
  let totalCost = 0
  const byModel: Record<string, ModelStats> = {}

  for (const r of results) {
    if (r.report) {
      totalPassed += r.report.summary.passed
      totalFailed += r.report.summary.failed
      for (const cr of r.report.results) {
        const m = (byModel[cr.modelId] ??= {
          passed: 0,
          failed: 0,
          tokens: 0,
          cost: 0,
          durationMs: 0,
        })
        if (cr.passed) m.passed++
        else m.failed++
        m.durationMs += cr.durationMs
        if (cr.usage?.totalTokens) {
          m.tokens += cr.usage.totalTokens
          totalTokens += cr.usage.totalTokens
        }
        if (cr.cost) {
          m.cost += cr.cost
          totalCost += cr.cost
        }
      }
    } else {
      totalFailed++
    }
  }

  return {
    totalPassed,
    totalFailed,
    totalTokens,
    totalCost,
    byModel,
    exitCode: totalFailed > 0 ? 1 : 0,
  }
}

// ─────────────────────────────────────────────────────────────────
// Flow Runner
// ─────────────────────────────────────────────────────────────────

/**
 * Run a single flow eval and return the result.
 */
export async function runOneFlow(
  entry: DiscoveredFlowEval,
  generate: EvalRunnerConfig['generate'],
  timeout?: number,
  concurrency?: number,
  onCaseComplete?: (flowName: string, caseResult: FlowEvalCaseResult) => void,
): Promise<FlowRunResult> {
  const start = Date.now()
  try {
    const report = await evaluateFlow({
      flowEval: entry.def,
      generate,
      timeout,
      concurrency,
      onCaseComplete: onCaseComplete ? (caseResult) => onCaseComplete(entry.name, caseResult) : undefined,
    })
    return {
      name: entry.name,
      report,
      durationMs: Date.now() - start,
      caseCount: entry.def.cases.length,
      configCount: entry.def.configs.length,
    }
  } catch (err) {
    return {
      name: entry.name,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
      caseCount: entry.def.cases.length,
      configCount: entry.def.configs.length,
    }
  }
}

/**
 * Run all flow evals with concurrency control, streaming per-case progress.
 */
export async function runAllFlows(opts: {
  flows: DiscoveredFlowEval[]
  config: EvalRunnerConfig
  onProgress?: (event: FlowProgress) => void
}): Promise<FlowRunResult[]> {
  const { flows, config, onProgress } = opts
  const timeout = config.timeout ?? 60_000
  const concurrency = config.concurrency ?? 5
  const results: FlowRunResult[] = []
  let idx = 0

  async function worker() {
    while (idx < flows.length) {
      const currentIdx = idx++
      const entry = flows[currentIdx]

      onProgress?.({
        type: 'flow:start',
        name: entry.name,
        index: currentIdx,
        total: flows.length,
      })

      const result = await runOneFlow(
        entry,
        config.generate,
        timeout,
        concurrency,
        // Stream individual case completions
        (flowName, caseResult) => {
          onProgress?.({
            type: 'flow:case',
            name: flowName,
            index: currentIdx,
            total: flows.length,
            caseResult,
          })
        },
      )
      results.push(result)

      onProgress?.({
        type: 'flow:done',
        name: entry.name,
        index: currentIdx,
        total: flows.length,
        result,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, flows.length) }, () => worker()))

  return results
}

/**
 * Run a single RAG eval definition and return the result.
 */
export async function runOneRagEval(entry: DiscoveredRagEval): Promise<RagRunResult> {
  const start = Date.now()
  try {
    const report = await evaluateRag(entry.def)
    return {
      name: entry.name,
      report,
      failedCases: report.exportFailedCases({ tag: 'regression' }),
      durationMs: Date.now() - start,
      caseCount: entry.def.dataset.cases.length,
    }
  } catch (err) {
    return {
      name: entry.name,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
      caseCount: entry.def.dataset.cases.length,
    }
  }
}

/**
 * Run all RAG evals with concurrency control.
 */
export async function runAllRagEvals(opts: {
  ragEvals: DiscoveredRagEval[]
  config: EvalRunnerConfig
  onProgress?: (event: RagProgress) => void
}): Promise<RagRunResult[]> {
  const { ragEvals, config, onProgress } = opts
  const concurrency = config.concurrency ?? 5
  const results: RagRunResult[] = []
  let idx = 0

  async function worker() {
    while (idx < ragEvals.length) {
      const currentIdx = idx++
      const entry = ragEvals[currentIdx]

      onProgress?.({
        type: 'rag:start',
        name: entry.name,
        index: currentIdx,
        total: ragEvals.length,
      })

      const result = await runOneRagEval(entry)
      results.push(result)

      onProgress?.({
        type: 'rag:done',
        name: entry.name,
        index: currentIdx,
        total: ragEvals.length,
        result,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ragEvals.length) }, () => worker()))

  return results
}

// ─────────────────────────────────────────────────────────────────
// Combined Summary
// ─────────────────────────────────────────────────────────────────

/**
 * Compute combined summary from both prompt eval and flow eval results.
 */
export function computeCombinedSummary(
  evalResults: RunResult[],
  flowResults: FlowRunResult[],
  ragResults: RagRunResult[] = [],
): EvalSummary {
  // Start with prompt eval summary
  const summary = computeSummary(evalResults)

  // Add flow eval stats
  for (const r of flowResults) {
    if (r.report) {
      summary.totalPassed += r.report.summary.passed
      summary.totalFailed += r.report.summary.failed
      summary.totalTokens += r.report.summary.totalTokens ?? 0
      summary.totalCost += r.report.summary.totalCost ?? 0

      // Add flow config stats to byModel using "config:name" keys
      for (const [configName, stats] of Object.entries(r.report.summary.byConfig)) {
        const key = `flow:${configName}`
        const m = (summary.byModel[key] ??= {
          passed: 0,
          failed: 0,
          tokens: 0,
          cost: 0,
          durationMs: 0,
        })
        m.passed += stats.passed
        m.failed += stats.failed
      }
    } else {
      summary.totalFailed++
    }
  }

  for (const r of ragResults) {
    if (r.report) {
      summary.totalPassed += r.report.summary.passed
      summary.totalFailed += r.report.summary.failed
      summary.totalCost += r.report.cases.reduce((sum, c) => sum + (c.cost ?? 0), 0)
      summary.totalTokens += r.report.cases.reduce((sum, c) => sum + (c.usage?.totalTokens ?? 0), 0)
    } else {
      summary.totalFailed++
    }
  }

  summary.exitCode = summary.totalFailed > 0 ? 1 : 0
  return summary
}
