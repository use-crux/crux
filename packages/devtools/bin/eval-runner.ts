#!/usr/bin/env tsx

/**
 * Standalone eval runner entry point.
 *
 * Spawned by the Go CLI binary. Communicates via NDJSON on stdout.
 * All other output (logs, errors) goes to stderr.
 *
 * Protocol (one JSON object per line on stdout):
 *   { "type": "config",   "evalCount": N, "flowCount": N, "configPath": "..." }
 *   { "type": "eval:start", "name": "...", "index": N, "total": N }
 *   { "type": "eval:done",  "name": "...", "index": N, "total": N, "result": RunResult }
 *   { "type": "flow:start", "name": "...", "index": N, "total": N }
 *   { "type": "flow:case",  "name": "...", "caseResult": FlowEvalCaseResult }
 *   { "type": "flow:done",  "name": "...", "index": N, "total": N, "result": FlowRunResult }
 *   { "type": "summary",   "summary": EvalSummary, "export": EvalExport }
 *   { "type": "error",     "message": "...", "name": "...", "stack": "...", "details": NormalizedObservedError }
 *
 * @module
 */

import { normalizeObservedError } from '@crux/core/observability'
import { loadEnv } from '../lib/env'
import {
  loadConfig,
  discoverEvals,
  discoverFlowEvals,
  discoverRagEvals,
  type DiscoveredRagEval,
} from '../lib/eval-discovery'
import { runAllEvals, runAllFlows, runAllRagEvals, computeCombinedSummary } from '../lib/eval-orchestrator'
import { serializeEvalResults, buildAnalysisPrompt } from '../lib/eval-export'
import { persistQualityEvalResults } from '../lib/quality-persistence'

// Redirect console.log to stderr so stdout is clean NDJSON.
const originalLog = console.log
console.log = (...args: unknown[]) => console.error(...args)

function emit(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

async function main() {
  const args = process.argv.slice(2)
  const configPath = getArg(args, '--config')
  const filter = getArg(args, '--filter')
  const persist = !hasFlag(args, '--no-persist')
  const caseIds = getRepeatedArg(args, '--case')

  try {
    // 0. Load .env.local from CWD (set by Go binary to the config directory).
    loadEnv()

    // 1. Load config.
    const loaded = await loadConfig(configPath)
    const { evalConfig, configDir } = loaded

    // 2. Discover evals.
    const evals = filterEvalCases(await discoverEvals(evalConfig.evals, filter), caseIds)
    const flowEvals = evalConfig.flowEvals
      ? filterFlowCases(await discoverFlowEvals(evalConfig.flowEvals, filter), caseIds)
      : []
    const ragEvals = evalConfig.ragEvals
      ? filterRagCases(await discoverRagEvals(evalConfig.ragEvals, filter), caseIds)
      : []

    emit({
      type: 'config',
      evalCount: evals.length,
      flowCount: flowEvals.length,
      ragCount: ragEvals.length,
      configPath: configPath ?? 'crux.config.ts',
    })

    // 3. Enable devtools if configured.
    if (evalConfig.devtools) {
      try {
        const { enableDevtools } = await import('@crux/core/observability')
        const allPrompts = [...evals.map((e) => e.def.prompt), ...ragEvals.map((e) => e.def.target.prompt)]
        enableDevtools({
          serverUrl:
            typeof evalConfig.devtools === 'string'
              ? evalConfig.devtools
              : (evalConfig.devtools.serverUrl ?? 'http://localhost:4400'),
          prompts: allPrompts,
        })
      } catch {
        // Devtools not available — continue without.
      }
    }

    // 4. Run prompt evals.
    const evalResults = await runAllEvals({
      evals,
      config: evalConfig,
      onProgress: (event) => emit({ ...event }),
    })

    // 5. Run flow evals.
    const flowResults = await runAllFlows({
      flows: flowEvals,
      config: evalConfig,
      onProgress: (event) => emit({ ...event }),
    })

    // 6. Run RAG evals.
    const ragResults = await runAllRagEvals({
      ragEvals,
      config: evalConfig,
      onProgress: (event) => emit({ ...event }),
    })

    // 7. Compute summary and export.
    const summary = computeCombinedSummary(evalResults, flowResults, ragResults)
    const exportData = serializeEvalResults(evalResults, flowResults, summary, ragResults)
    const analysisPrompt = buildAnalysisPrompt(exportData)
    const definitionFingerprints = await loadDefinitionFingerprints(configDir, configPath)
    const qualityRecords = persist
      ? await persistQualityEvalResults({
          quality: loaded.quality,
          configDir,
          evalResults,
          flowResults,
          ragResults,
          definitionFingerprints,
        })
      : []

    if (qualityRecords.length > 0) {
      emit({
        type: 'quality:persisted',
        count: qualityRecords.length,
        experimentIds: qualityRecords.map((record) => record.id),
      })
    }

    emit({
      type: 'summary',
      summary,
      export: exportData,
      analysisPrompt,
    })

    process.exit(summary.exitCode)
  } catch (err) {
    const details = normalizeObservedError(err, {
      phase: 'eval_runner.main',
      errorKind: 'eval_runner_error',
    })
    emit({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.name ? { name: err.name } : {}),
      ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      details,
    })
    process.exit(2)
  }
}

async function loadDefinitionFingerprints(
  root: string,
  configPath: string | undefined,
): Promise<Record<string, string> | undefined> {
  try {
    const { indexProject } = await import('@crux/indexer')
    const index = await indexProject({ root, configPath, staticOnly: true })
    const fingerprints: Record<string, string> = {}
    for (const definition of index.definitions) {
      if (definition.fingerprint) {
        fingerprints[definition.id] = definition.fingerprint
      }
    }
    return fingerprints
  } catch {
    return undefined
  }
}

function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

function getRepeatedArg(args: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && index + 1 < args.length) {
      values.push(args[index + 1])
      index++
    }
  }
  return values
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function filterEvalCases<TEntry extends { def: { cases: Array<{ name: string }> } }>(
  entries: TEntry[],
  caseIds: readonly string[],
): TEntry[] {
  if (caseIds.length === 0) return entries
  const wanted = new Set(caseIds)
  return entries
    .map((entry) => ({
      ...entry,
      def: { ...entry.def, cases: entry.def.cases.filter((item) => wanted.has(item.name)) },
    }))
    .filter((entry) => entry.def.cases.length > 0) as TEntry[]
}

function filterFlowCases<TEntry extends { def: { cases: Array<{ name: string }> } }>(
  entries: TEntry[],
  caseIds: readonly string[],
): TEntry[] {
  return filterEvalCases(entries, caseIds)
}

function filterRagCases(entries: DiscoveredRagEval[], caseIds: readonly string[]): DiscoveredRagEval[] {
  if (caseIds.length === 0) return entries
  const wanted = new Set(caseIds)
  return entries
    .map((entry) => ({
      ...entry,
      def: {
        ...entry.def,
        dataset: {
          ...entry.def.dataset,
          cases: entry.def.dataset.cases.filter(
            (item) => wanted.has(item.id) || (item.name ? wanted.has(item.name) : false),
          ),
        },
      },
    }))
    .filter((entry) => entry.def.dataset.cases.length > 0)
}

main()
