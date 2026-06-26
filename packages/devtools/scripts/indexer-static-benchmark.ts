#!/usr/bin/env tsx

/**
 * Static syntax frontend benchmark for TypeScript vs Rust/Oxc.
 *
 * The benchmark preloads selected source files into memory and disables the persistent static cache.
 * Timings therefore focus on parser frontend and static extraction cost rather than filesystem I/O or
 * cache hits.
 *
 * @module
 */

import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  preloadStaticSources,
  runStaticFrontendExtraction,
  staticParityFiles,
  type StaticFrontendName,
} from '../lib/indexer-static-comparison'
import type { IndexerExtension } from '../../indexer/indexer/extensions'
import type { StaticExtractionTimingName } from '../../indexer/indexer/static/extraction/engine'
import { measureProcessTreeMemoryDuring } from './process-memory'

interface StaticBenchmarkArgs {
  readonly root: string
  readonly concurrency: number
  readonly iterations: number
  readonly frontends: readonly StaticFrontendName[]
  readonly syntheticExtensions: number
  readonly syntheticExtensionMode: SyntheticExtensionMode
  readonly syntheticExtensionEvidence: SyntheticExtensionEvidenceMode
}

type SyntheticExtensionMode = 'unused' | 'hot-prompt'
type SyntheticExtensionEvidenceMode = 'declared' | 'compatibility'

interface TimedRun {
  readonly frontend: StaticFrontendName
  readonly iteration: number
  readonly elapsedMs: number
  readonly files: number
  readonly definitions: number
  readonly relations: number
  readonly diagnostics: number
  readonly errors: number
  readonly rssStartMb: number
  readonly rssEndMb: number
  readonly rssPeakMb: number
  readonly phaseTimings: readonly StaticPhaseTiming[]
}

interface StaticPhaseTiming {
  readonly name: StaticExtractionTimingName
  readonly totalMs: number
  readonly count: number
}

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const files = staticParityFiles(args.root)
  const sources = preloadStaticSources(files)
  const extensions = syntheticExtensions(
    args.syntheticExtensions,
    args.syntheticExtensionMode,
    args.syntheticExtensionEvidence,
  )
  const runs: TimedRun[] = []

  console.log(`Project Index static benchmark root: ${args.root}`)
  console.log(
    [
      'mode: no persistent cache, preloaded sources',
      `frontends=${args.frontends.join(',')}`,
      `files=${files.length}`,
      `iterations=${args.iterations}`,
      `concurrency=${args.concurrency}`,
      `syntheticExtensions=${args.syntheticExtensions}`,
      `syntheticExtensionMode=${args.syntheticExtensionMode}`,
      `syntheticExtensionEvidence=${args.syntheticExtensionEvidence}`,
    ].join(' '),
  )

  for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
    for (const frontend of frontendsForIteration(args.frontends, iteration)) {
      const phaseTimings = new Map<StaticExtractionTimingName, StaticPhaseTiming>()
      const started = performance.now()
      const { value: result, memory } = await measureProcessTreeMemoryDuring(() =>
        runStaticFrontendExtraction({
          root: args.root,
          files,
          frontend,
          sources,
          concurrency: args.concurrency,
          extensions,
          instrumentation: {
            onTiming: (timing) => addPhaseTiming(phaseTimings, timing.name, timing.durationMs),
          },
        }),
      )
      const elapsedMs = performance.now() - started
      const run = {
        frontend,
        iteration,
        elapsedMs,
        files: result.totals.files,
        definitions: result.totals.definitions,
        relations: result.totals.relations,
        diagnostics: result.totals.diagnostics,
        errors: result.errors.length,
        rssStartMb: memory.rssStartMb,
        rssEndMb: memory.rssEndMb,
        rssPeakMb: memory.rssPeakMb,
        phaseTimings: [...phaseTimings.values()].sort((a, b) => b.totalMs - a.totalMs),
      } satisfies TimedRun
      runs.push(run)
      printRun(run)
      if (run.errors > 0) process.exitCode = 1
    }
  }

  for (const frontend of args.frontends) printSummary(frontend, runs)
  printRatios(runs)
}

function frontendsForIteration(frontends: readonly StaticFrontendName[], iteration: number): readonly StaticFrontendName[] {
  if (frontends.length < 2 || iteration % 2 === 1) return frontends
  return [...frontends].reverse()
}

function printRun(run: TimedRun): void {
  console.log(
    [
      `${run.frontend}[${run.iteration}]:`,
      `elapsed=${run.elapsedMs.toFixed(1)}ms`,
      `files=${run.files}`,
      `definitions=${run.definitions}`,
      `relations=${run.relations}`,
      `diagnostics=${run.diagnostics}`,
      `errors=${run.errors}`,
      `treeRssStart=${run.rssStartMb.toFixed(1)}MB`,
      `treeRssEnd=${run.rssEndMb.toFixed(1)}MB`,
      `treeRssPeak=${run.rssPeakMb.toFixed(1)}MB`,
    ].join(' '),
  )
  const phases = run.phaseTimings
    .slice(0, 6)
    .map((timing) => `${timing.name}=${timing.totalMs.toFixed(1)}ms/${timing.count}`)
  if (phases.length > 0) console.log(`  phases: ${phases.join(' ')}`)
}

function printSummary(frontend: StaticFrontendName, runs: readonly TimedRun[]): void {
  const frontendRuns = runs.filter((run) => run.frontend === frontend)
  const values = frontendRuns.map((run) => run.elapsedMs)
  if (values.length === 0) return
  const rssPeaks = frontendRuns.map((run) => run.rssPeakMb)
  console.log(
    [
      `${frontend}:`,
      `avg=${average(values).toFixed(1)}ms`,
      `min=${Math.min(...values).toFixed(1)}ms`,
      `max=${Math.max(...values).toFixed(1)}ms`,
      `rssPeakAvg=${average(rssPeaks).toFixed(1)}MB`,
      `rssPeakMax=${Math.max(...rssPeaks).toFixed(1)}MB`,
    ].join(' '),
  )
}

function printRatios(runs: readonly TimedRun[]): void {
  const typescript = average(runs.filter((run) => run.frontend === 'typescript').map((run) => run.elapsedMs))
  if (!Number.isFinite(typescript)) return
  for (const frontend of uniqueFrontends(runs).filter((frontend) => frontend !== 'typescript')) {
    const value = average(runs.filter((run) => run.frontend === frontend).map((run) => run.elapsedMs))
    if (!Number.isFinite(value) || value === 0) continue
    if (value < typescript) {
      console.log(`ratio: ${frontend} is ${(typescript / value).toFixed(2)}x faster than typescript by average elapsed time`)
    } else {
      console.log(`ratio: ${frontend} is ${(value / typescript).toFixed(2)}x slower than typescript by average elapsed time`)
    }
  }
}

function parseArgs(argv: readonly string[]): StaticBenchmarkArgs {
  const rootFlag = valueFlag(argv, '--root')
  return {
    root: resolveRoot(rootFlag ?? WORKSPACE_ROOT),
    concurrency: positiveInteger(valueFlag(argv, '--concurrency'), 8),
    iterations: positiveInteger(valueFlag(argv, '--iterations'), 3),
    frontends: frontendList(valueFlag(argv, '--frontends')),
    syntheticExtensions: positiveInteger(valueFlag(argv, '--synthetic-extensions'), 0, { allowZero: true }),
    syntheticExtensionMode: syntheticExtensionMode(valueFlag(argv, '--synthetic-extension-mode')),
    syntheticExtensionEvidence: syntheticExtensionEvidenceMode(valueFlag(argv, '--synthetic-extension-evidence')),
  }
}

function syntheticExtensions(
  count: number,
  mode: SyntheticExtensionMode,
  evidenceMode: SyntheticExtensionEvidenceMode,
): readonly IndexerExtension[] {
  const namePrefix = mode === 'hot-prompt' ? '@aa-bench' : '@zz-bench'
  return Array.from({ length: count }, (_, index) => ({
    name: `${namePrefix}/static-extension-${index.toString().padStart(3, '0')}`,
    version: '1',
    static: {
      evidence: {
        mode: evidenceMode,
        ...(evidenceMode === 'compatibility' ? { reason: 'Synthetic legacy benchmark extension.' } : {}),
      },
      ...(evidenceMode === 'declared'
        ? {
            interests: {
              calls: [{ name: mode === 'hot-prompt' ? 'prompt' : `__cruxBenchUnused${index}` }],
            },
          }
        : {}),
    },
    extractors: [
      {
        name: `extract-${mode}`,
        patterns: [{ kind: 'call', name: mode === 'hot-prompt' ? 'prompt' : `__cruxBenchUnused${index}` }],
        extract: () => ({ kind: 'none' as const }),
      },
    ],
  }))
}

function syntheticExtensionEvidenceMode(value: string | undefined): SyntheticExtensionEvidenceMode {
  if (!value || value === 'declared') return 'declared'
  if (value === 'compatibility') return value
  throw new Error(`Unknown synthetic extension evidence mode ${value}`)
}

function syntheticExtensionMode(value: string | undefined): SyntheticExtensionMode {
  if (!value || value === 'unused') return 'unused'
  if (value === 'hot-prompt') return value
  throw new Error(`Unknown synthetic extension mode ${value}`)
}

function frontendList(value: string | undefined): readonly StaticFrontendName[] {
  const raw = value?.split(',').filter(Boolean) ?? ['typescript', 'oxc-rust']
  return raw.map((frontend) => {
    if (frontend === 'typescript' || frontend === 'oxc-rust') return frontend
    throw new Error(`Unknown static frontend ${frontend}`)
  })
}

function uniqueFrontends(runs: readonly TimedRun[]): readonly StaticFrontendName[] {
  return [...new Set(runs.map((run) => run.frontend))]
}

function valueFlag(argv: readonly string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

function resolveRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(WORKSPACE_ROOT, root)
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  options: { readonly allowZero?: boolean } = {},
): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  const min = options.allowZero ? 0 : 1
  if (!Number.isInteger(parsed) || parsed < min) throw new Error(`Expected an integer >= ${min}, received ${value}`)
  return parsed
}

function addPhaseTiming(
  timings: Map<StaticExtractionTimingName, StaticPhaseTiming>,
  name: StaticExtractionTimingName,
  durationMs: number,
): void {
  const previous = timings.get(name)
  timings.set(name, {
    name,
    totalMs: (previous?.totalMs ?? 0) + durationMs,
    count: (previous?.count ?? 0) + 1,
  })
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
