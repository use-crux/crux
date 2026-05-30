/**
 * Eval export — serializes eval results to JSON and builds LLM analysis prompts.
 *
 * Pure functions, no React/Ink dependency.
 *
 * @module
 */

import type { RunResult, FlowRunResult, RagRunResult, EvalSummary } from './eval-orchestrator'

// ─────────────────────────────────────────────────────────────────
// Export Types
// ─────────────────────────────────────────────────────────────────

export interface EvalExport {
  meta: {
    timestamp: string
    totalDurationMs: number
    version: '1'
    generatedBy: '@crux/devtools'
  }
  summary: {
    total: number
    passed: number
    failed: number
    passRate: string
    totalTokens: number
    totalCost: number
    models: Record<
      string,
      {
        passed: number
        failed: number
        passRate: string
        tokens: number
        cost: number
        avgDurationMs: number
      }
    >
  }
  failures: Array<{
    type: 'prompt' | 'flow' | 'rag'
    evalName: string
    caseName: string
    modelOrConfig: string
    error?: string
    durationMs: number
  }>
  promptEvals: Array<{
    name: string
    caseCount: number
    durationMs: number
    error?: string
    results: Array<{
      caseName: string
      modelId: string
      passed: boolean
      durationMs: number
      error?: string
      tokens?: { input: number; output: number; total: number }
      cost?: number
    }>
    summary: {
      total: number
      passed: number
      failed: number
      passRate: string
      byModel: Record<string, { total: number; passed: number; failed: number; passRate: string }>
    }
  }>
  flowEvals: Array<{
    name: string
    caseCount: number
    configCount: number
    durationMs: number
    error?: string
    results: Array<{
      caseName: string
      configName: string
      passed: boolean
      durationMs: number
      error?: string
      trace: {
        steps: Array<{
          id: string
          skipped: boolean
          durationMs: number
          tokens?: { input: number; output: number; total: number }
          cost?: number
          input?: unknown
          output?: unknown
          outputTruncated?: boolean
          text?: string
          textTruncated?: boolean
          toolCalls?: Array<{ name: string; args: unknown; result?: unknown }>
          toolStepCount?: number
          turns?: Array<{
            userMessage: string
            response: string
            responseTruncated?: boolean
            toolCalls: Array<{ name: string; args: unknown; result?: unknown }>
            toolStepCount: number
            durationMs: number
            tokens?: { input: number; output: number; total: number }
            cost?: number
          }>
          turnCount?: number
          totalToolStepCount?: number
        }>
        totalTokens: { input: number; output: number; total: number }
        totalCost: number
        durationMs: number
        error?: string
      }
    }>
    summary: {
      total: number
      passed: number
      failed: number
      passRate: string
      byConfig: Record<string, { total: number; passed: number; failed: number; passRate: string }>
      totalSteps: number
      avgSteps: number
      totalTokens: number
      totalCost: number
    }
  }>
  ragEvals: Array<{
    name: string
    suiteId?: string
    caseCount: number
    durationMs: number
    error?: string
    summary?: {
      total: number
      passed: number
      failed: number
      passRate: string
      failureGroups: Array<{ type: string; count: number; caseIds: readonly string[] }>
    }
    failedCases?: unknown
  }>
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const TRUNCATE_LIMIT = 2000

function pct(passed: number, total: number): string {
  if (total === 0) return '0%'
  return `${((passed / total) * 100).toFixed(1)}%`
}

function truncateStr(s: string | undefined): { value: string; truncated: boolean } | undefined {
  if (s == null) return undefined
  if (s.length <= TRUNCATE_LIMIT) return { value: s, truncated: false }
  return { value: s.slice(0, TRUNCATE_LIMIT), truncated: true }
}

function truncateUnknown(v: unknown): { value: unknown; truncated: boolean } | undefined {
  if (v === undefined || v === null) return undefined
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s == null) return undefined
  if (s.length <= TRUNCATE_LIMIT) return { value: v, truncated: false }
  // For objects/arrays, return truncated stringified version
  if (typeof v !== 'string') {
    return { value: s.slice(0, TRUNCATE_LIMIT), truncated: true }
  }
  return { value: s.slice(0, TRUNCATE_LIMIT), truncated: true }
}

/**
 * Remove keys with undefined values from an object (shallow).
 */
function clean<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      ;(result as Record<string, unknown>)[k] = v
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────
// Serializer
// ─────────────────────────────────────────────────────────────────

/**
 * Serialize eval results into a clean export structure.
 */
export function serializeEvalResults(
  evalResults: RunResult[],
  flowResults: FlowRunResult[],
  summary: EvalSummary,
  ragResults: RagRunResult[] = [],
): EvalExport {
  // Compute total duration from individual results
  const totalDurationMs =
    evalResults.reduce((sum, r) => sum + r.durationMs, 0) +
    flowResults.reduce((sum, r) => sum + r.durationMs, 0) +
    ragResults.reduce((sum, r) => sum + r.durationMs, 0)

  const total = summary.totalPassed + summary.totalFailed
  const failures: EvalExport['failures'] = []

  // ── Prompt evals ───────────────────────────────────────────────

  const promptEvals: EvalExport['promptEvals'] = evalResults.map((r) => {
    if (!r.report) {
      // Top-level error — no case results
      failures.push({
        type: 'prompt',
        evalName: r.name,
        caseName: '(eval error)',
        modelOrConfig: '—',
        error: r.error,
        durationMs: r.durationMs,
      })
      return {
        name: r.name,
        caseCount: r.caseCount,
        durationMs: r.durationMs,
        error: r.error,
        results: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          passRate: '0%',
          byModel: {},
        },
      }
    }

    const results = r.report.results.map((cr) => {
      if (!cr.passed) {
        failures.push({
          type: 'prompt',
          evalName: r.name,
          caseName: cr.caseName,
          modelOrConfig: cr.modelId,
          error: cr.error,
          durationMs: cr.durationMs,
        })
      }

      return clean({
        caseName: cr.caseName,
        modelId: cr.modelId,
        passed: cr.passed,
        durationMs: cr.durationMs,
        error: cr.error,
        tokens: cr.usage?.totalTokens
          ? {
              input: cr.usage.inputTokens ?? 0,
              output: cr.usage.outputTokens ?? 0,
              total: cr.usage.totalTokens,
            }
          : undefined,
        cost: cr.cost,
      })
    })

    const byModel: Record<string, { total: number; passed: number; failed: number; passRate: string }> = {}
    for (const [modelId, stats] of Object.entries(r.report.summary.byModel)) {
      byModel[modelId] = {
        ...stats,
        passRate: pct(stats.passed, stats.total),
      }
    }

    return {
      name: r.name,
      caseCount: r.caseCount,
      durationMs: r.durationMs,
      results,
      summary: {
        total: r.report.summary.total,
        passed: r.report.summary.passed,
        failed: r.report.summary.failed,
        passRate: pct(r.report.summary.passed, r.report.summary.total),
        byModel,
      },
    }
  })

  // ── Flow evals ─────────────────────────────────────────────────

  const flowEvals: EvalExport['flowEvals'] = flowResults.map((r) => {
    if (!r.report) {
      failures.push({
        type: 'flow',
        evalName: r.name,
        caseName: '(eval error)',
        modelOrConfig: '—',
        error: r.error,
        durationMs: r.durationMs,
      })
      return {
        name: r.name,
        caseCount: r.caseCount,
        configCount: r.configCount,
        durationMs: r.durationMs,
        error: r.error,
        results: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          passRate: '0%',
          byConfig: {},
          totalSteps: 0,
          avgSteps: 0,
          totalTokens: 0,
          totalCost: 0,
        },
      }
    }

    const results = r.report.results.map((cr) => {
      if (!cr.passed) {
        failures.push({
          type: 'flow',
          evalName: r.name,
          caseName: cr.caseName,
          modelOrConfig: cr.configName,
          error: cr.error,
          durationMs: cr.durationMs,
        })
      }

      // Serialize trace from stepResults (plain Record, not the .step() method)
      const steps = Object.values(cr.trace.stepResults).map((sr) => {
        const outputT = truncateUnknown(sr.output)
        const textT = truncateStr(sr.text)

        return clean({
          id: sr.id,
          skipped: sr.skipped,
          durationMs: sr.durationMs,
          tokens: sr.usage?.totalTokens
            ? {
                input: sr.usage.inputTokens ?? 0,
                output: sr.usage.outputTokens ?? 0,
                total: sr.usage.totalTokens,
              }
            : undefined,
          cost: sr.cost,
          input: sr.input,
          output: outputT?.value,
          outputTruncated: outputT?.truncated || undefined,
          text: textT?.value,
          textTruncated: textT?.truncated || undefined,
          toolCalls: sr.toolCalls?.map((tc) => {
            const resultT = truncateUnknown(tc.result)
            return clean({
              name: tc.name,
              args: tc.args,
              result: resultT?.value,
            })
          }),
          toolStepCount: sr.toolStepCount,
          turns: sr.turns?.map((t) => {
            const respT = truncateStr(t.response)
            return clean({
              userMessage: t.userMessage,
              response: respT?.value ?? t.response,
              responseTruncated: respT?.truncated || undefined,
              toolCalls: t.toolCalls.map((tc) => {
                const resultT = truncateUnknown(tc.result)
                return clean({
                  name: tc.name,
                  args: tc.args,
                  result: resultT?.value,
                })
              }),
              toolStepCount: t.toolStepCount,
              durationMs: t.durationMs,
              tokens: t.usage?.totalTokens
                ? {
                    input: t.usage.inputTokens ?? 0,
                    output: t.usage.outputTokens ?? 0,
                    total: t.usage.totalTokens,
                  }
                : undefined,
              cost: t.cost,
            })
          }),
          turnCount: sr.turnCount,
          totalToolStepCount: sr.totalToolStepCount,
        })
      })

      return clean({
        caseName: cr.caseName,
        configName: cr.configName,
        passed: cr.passed,
        durationMs: cr.durationMs,
        error: cr.error,
        trace: {
          steps,
          totalTokens: {
            input: cr.trace.totalUsage.inputTokens ?? 0,
            output: cr.trace.totalUsage.outputTokens ?? 0,
            total: cr.trace.totalUsage.totalTokens ?? 0,
          },
          totalCost: cr.trace.totalCost,
          durationMs: cr.trace.durationMs,
          error: cr.trace.error,
        },
      })
    })

    const byConfig: Record<string, { total: number; passed: number; failed: number; passRate: string }> = {}
    for (const [configName, stats] of Object.entries(r.report.summary.byConfig)) {
      byConfig[configName] = {
        ...stats,
        passRate: pct(stats.passed, stats.total),
      }
    }

    return {
      name: r.name,
      caseCount: r.caseCount,
      configCount: r.configCount,
      durationMs: r.durationMs,
      results,
      summary: {
        total: r.report.summary.total,
        passed: r.report.summary.passed,
        failed: r.report.summary.failed,
        passRate: pct(r.report.summary.passed, r.report.summary.total),
        byConfig,
        totalSteps: r.report.summary.totalSteps,
        avgSteps: r.report.summary.avgSteps,
        totalTokens: r.report.summary.totalTokens,
        totalCost: r.report.summary.totalCost,
      },
    }
  })

  const ragEvals: EvalExport['ragEvals'] = ragResults.map((r) => {
    if (!r.report) {
      failures.push({
        type: 'rag',
        evalName: r.name,
        caseName: '(eval error)',
        modelOrConfig: '—',
        error: r.error,
        durationMs: r.durationMs,
      })
      return {
        name: r.name,
        caseCount: r.caseCount,
        durationMs: r.durationMs,
        error: r.error,
      }
    }

    for (const cr of r.report.cases) {
      if (!cr.passed) {
        failures.push({
          type: 'rag',
          evalName: r.name,
          caseName: cr.caseName,
          modelOrConfig: cr.configLabel ?? cr.configRole ?? 'single',
          error: cr.error ?? cr.primaryFailureType,
          durationMs: cr.durationMs,
        })
      }
    }

    return {
      name: r.name,
      suiteId: r.report.datasetId,
      caseCount: r.caseCount,
      durationMs: r.durationMs,
      summary: {
        total: r.report.summary.total,
        passed: r.report.summary.passed,
        failed: r.report.summary.failed,
        passRate: pct(r.report.summary.passed, r.report.summary.total),
        failureGroups: [...r.report.summary.failureGroups],
      },
      failedCases: r.failedCases,
    }
  })

  // ── Summary models — exclude flow: prefixed keys ───────────────

  const models: EvalExport['summary']['models'] = {}
  for (const [key, stats] of Object.entries(summary.byModel)) {
    if (key.startsWith('flow:')) continue
    const modelTotal = stats.passed + stats.failed
    models[key] = {
      passed: stats.passed,
      failed: stats.failed,
      passRate: pct(stats.passed, modelTotal),
      tokens: stats.tokens,
      cost: stats.cost,
      avgDurationMs: modelTotal > 0 ? Math.round(stats.durationMs / modelTotal) : 0,
    }
  }

  return {
    meta: {
      timestamp: new Date().toISOString(),
      totalDurationMs,
      version: '1',
      generatedBy: '@crux/devtools',
    },
    summary: {
      total,
      passed: summary.totalPassed,
      failed: summary.totalFailed,
      passRate: pct(summary.totalPassed, total),
      totalTokens: summary.totalTokens,
      totalCost: summary.totalCost,
      models,
    },
    failures,
    promptEvals,
    flowEvals,
    ragEvals,
  }
}

// ─────────────────────────────────────────────────────────────────
// Analysis Prompt Builder
// ─────────────────────────────────────────────────────────────────

/**
 * Build a self-contained markdown prompt for LLM analysis of eval results.
 */
export function buildAnalysisPrompt(data: EvalExport): string {
  const json = JSON.stringify(data, null, 2)
  const approxTokens = Math.ceil(json.length / 4)
  const promptCount = data.promptEvals.length
  const flowCount = data.flowEvals.length
  const failureCount = data.failures.length

  return `# Eval Results Analysis

You are an expert prompt evaluation analyst. Analyze the following eval results and produce a detailed, structured report.

## Metadata

- **Generated**: ${data.meta.timestamp}
- **Duration**: ${(data.meta.totalDurationMs / 1000).toFixed(1)}s
- **Prompt evals**: ${promptCount}
- **Flow evals**: ${flowCount}
- **Total cases**: ${data.summary.total} (${data.summary.passed} passed, ${data.summary.failed} failed)
- **Overall pass rate**: ${data.summary.passRate}
- **Failures**: ${failureCount}
- **Approximate token count of data**: ~${approxTokens.toLocaleString()} tokens

## Analysis Sections

Address each of the following sections **in order**. Number your sections to match.

### 1. Executive Summary

Provide a 2-3 sentence overall assessment. Classify the results:
- **Green**: ≥95% pass rate, no critical failures
- **Yellow**: 80-95% pass rate, or failures concentrated in specific areas
- **Red**: <80% pass rate, or widespread/systematic failures

### 2. Failure Deep-Dive

For **EVERY** failure in the \`failures\` array (there are ${failureCount}):
- Case name and eval name
- Model or config that failed
- Error message (exact quote)
- Root cause assessment (your analysis of why it failed)
- Severity: **critical** (blocks production), **high** (degrades quality), **medium** (edge case), **low** (cosmetic)

If there are no failures, state that explicitly and move on.

### 3. Model Comparison

Compare models across these dimensions:
- Pass rate (use the pre-computed percentages)
- Token efficiency (tokens per case)
- Cost efficiency (cost per case)
- Latency (average duration)
- Identify the best overall model and best value model

### 4. Flow Pipeline Analysis

For each flow eval:
- Identify bottleneck steps (highest duration or token usage)
- Note any skip patterns and whether they indicate issues
- Analyze tool calling patterns (which tools, how often)
- Compare configs: which performs better and why

If there are no flow evals, skip this section.

### 5. Patterns & Anomalies

Look for:
- **Cross-model failures** (same case fails on multiple models → likely a prompt bug)
- **Single-model failures** (one model fails where others pass → model limitation)
- **Duration outliers** (cases taking significantly longer than average)
- **Token usage anomalies** (unexpectedly high/low token consumption)

### 6. Recommendations

Provide a prioritized list of concrete, actionable recommendations. For each:
- What to change
- Why (cite specific data points)
- Expected impact

## Guidelines

- **Cite exact numbers** from the data — do not approximate when precise values are available
- **Show your reasoning** — explain how you reached each conclusion
- **Distinguish prompt bugs from model limitations** — a case that fails on all models is likely a prompt issue; a case that fails on one model is likely a model issue
- **Use the \`failures\` array** as your starting point — it contains every failure with full context, so you don't need to scan nested structures

## Data

\`\`\`json
${json}
\`\`\`
`
}
