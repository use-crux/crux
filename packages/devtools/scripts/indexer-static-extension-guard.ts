#!/usr/bin/env tsx

/**
 * Measures the static-indexing tax of enabling TypeScript extensions.
 *
 * The guard compares one native frontend baseline against declared and compatibility synthetic
 * extensions. Threshold flags are optional so the script can be used both as a reporting tool and as
 * a CI gate once stable project-specific budgets are chosen.
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
import { measureProcessTreeMemoryDuring } from './process-memory'

interface Args {
  readonly root: string
  readonly frontend: StaticFrontendName
  readonly concurrency: number
  readonly iterations: number
  readonly manyCount: number
  readonly maxOneDeclaredOverheadMs?: number
  readonly maxManyDeclaredOverheadMs?: number
}

interface Scenario {
  readonly name: string
  readonly extensions: readonly IndexerExtension[]
}

interface ScenarioResult {
  readonly name: string
  readonly avgMs: number
  readonly minMs: number
  readonly maxMs: number
  readonly rssPeakAvgMb: number
  readonly rssPeakMaxMb: number
  readonly errors: number
}

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const files = staticParityFiles(args.root)
  const sources = preloadStaticSources(files)
  const scenarios: readonly Scenario[] = [
    { name: 'baseline', extensions: [] },
    { name: 'one-declared-hot', extensions: syntheticExtensions(1, 'declared') },
    { name: 'many-declared-hot', extensions: syntheticExtensions(args.manyCount, 'declared') },
    { name: 'one-compatibility-hot', extensions: syntheticExtensions(1, 'compatibility') },
  ]

  console.log(
    [
      `Project Index static extension guard root: ${args.root}`,
      `frontend=${args.frontend}`,
      `files=${files.length}`,
      `iterations=${args.iterations}`,
      `concurrency=${args.concurrency}`,
      `manyCount=${args.manyCount}`,
    ].join(' '),
  )

  const results: ScenarioResult[] = []
  for (const scenario of scenarios) {
    const result = await runScenario(args, files, sources, scenario)
    results.push(result)
    printScenario(result)
  }

  const baseline = results.find((result) => result.name === 'baseline')
  if (!baseline) throw new Error('baseline scenario did not run')
  printOverhead('one-declared-hot', baseline, results, args.maxOneDeclaredOverheadMs)
  printOverhead('many-declared-hot', baseline, results, args.maxManyDeclaredOverheadMs)
  printOverhead('one-compatibility-hot', baseline, results)
}

async function runScenario(
  args: Args,
  files: readonly string[],
  sources: ReadonlyMap<string, string>,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const elapsed: number[] = []
  const rssPeaks: number[] = []
  let errors = 0
  for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
    const started = performance.now()
    const { value, memory } = await measureProcessTreeMemoryDuring(() =>
      runStaticFrontendExtraction({
        root: args.root,
        files,
        frontend: args.frontend,
        sources,
        concurrency: args.concurrency,
        extensions: scenario.extensions,
      }),
    )
    const elapsedMs = performance.now() - started
    elapsed.push(elapsedMs)
    rssPeaks.push(memory.rssPeakMb)
    errors += value.errors.length
    console.log(
      `${scenario.name}[${iteration}]: elapsed=${elapsedMs.toFixed(1)}ms treeRssPeak=${memory.rssPeakMb.toFixed(1)}MB errors=${value.errors.length}`,
    )
  }
  return {
    name: scenario.name,
    avgMs: average(elapsed),
    minMs: Math.min(...elapsed),
    maxMs: Math.max(...elapsed),
    rssPeakAvgMb: average(rssPeaks),
    rssPeakMaxMb: Math.max(...rssPeaks),
    errors,
  }
}

function syntheticExtensions(count: number, evidenceMode: 'declared' | 'compatibility'): readonly IndexerExtension[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `@bench/static-extension-${index.toString().padStart(3, '0')}`,
    version: '1',
    static: {
      evidence: {
        mode: evidenceMode,
        ...(evidenceMode === 'compatibility' ? { reason: 'Synthetic legacy benchmark extension.' } : {}),
      },
      ...(evidenceMode === 'declared'
        ? {
            interests: {
              calls: [{ name: 'prompt', properties: ['id'], callbacks: [{ property: 'prompt' }] }],
            },
          }
        : {}),
    },
    extractors: [
      {
        name: 'hot-prompt',
        patterns: [{ kind: 'call', name: 'prompt' }],
        extract: () => ({ kind: 'none' as const }),
      },
    ],
  }))
}

function printScenario(result: ScenarioResult): void {
  console.log(
    [
      `${result.name}:`,
      `avg=${result.avgMs.toFixed(1)}ms`,
      `min=${result.minMs.toFixed(1)}ms`,
      `max=${result.maxMs.toFixed(1)}ms`,
      `rssPeakAvg=${result.rssPeakAvgMb.toFixed(1)}MB`,
      `rssPeakMax=${result.rssPeakMaxMb.toFixed(1)}MB`,
      `errors=${result.errors}`,
    ].join(' '),
  )
}

function printOverhead(
  name: string,
  baseline: ScenarioResult,
  results: readonly ScenarioResult[],
  maxOverheadMs?: number,
): void {
  const result = results.find((item) => item.name === name)
  if (!result) return
  const overheadMs = result.avgMs - baseline.avgMs
  const rssOverheadMb = result.rssPeakAvgMb - baseline.rssPeakAvgMb
  console.log(
    `overhead:${name}: elapsed=${overheadMs.toFixed(1)}ms rss=${rssOverheadMb.toFixed(1)}MB threshold=${maxOverheadMs ?? 'n/a'}ms`,
  )
  if (maxOverheadMs !== undefined && overheadMs > maxOverheadMs) {
    process.exitCode = 1
  }
}

function parseArgs(argv: readonly string[]): Args {
  const rootFlag = valueFlag(argv, '--root')
  return {
    root: resolveRoot(rootFlag ?? WORKSPACE_ROOT),
    frontend: frontend(valueFlag(argv, '--frontend')),
    concurrency: positiveInteger(valueFlag(argv, '--concurrency'), 8),
    iterations: positiveInteger(valueFlag(argv, '--iterations'), 3),
    manyCount: positiveInteger(valueFlag(argv, '--many-count'), 50),
    maxOneDeclaredOverheadMs: optionalNumber(valueFlag(argv, '--max-one-declared-overhead-ms')),
    maxManyDeclaredOverheadMs: optionalNumber(valueFlag(argv, '--max-many-declared-overhead-ms')),
  }
}

function frontend(value: string | undefined): StaticFrontendName {
  if (!value || value === 'oxc-rust') return 'oxc-rust'
  if (value === 'typescript' || value === 'oxc') return value
  throw new Error(`Unknown static frontend ${value}`)
}

function valueFlag(argv: readonly string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

function resolveRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(WORKSPACE_ROOT, root)
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received ${value}`)
  return parsed
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Expected a non-negative number, received ${value}`)
  return parsed
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
