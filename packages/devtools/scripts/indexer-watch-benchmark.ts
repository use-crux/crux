#!/usr/bin/env tsx

/**
 * Warm Project Index watch-path benchmark for incremental architecture work.
 *
 * The benchmark starts from a warm AST snapshot, mutates one representative file per
 * scenario, and measures the incremental worker result. Non-fixture roots are copied to
 * a temporary directory by default so benchmark edits never touch the source project.
 *
 * @module
 */

import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { indexProjectAst, indexProjectIncremental } from '@crux/indexer'
import type { IncrementalExecutionMode, IncrementalIndexExecutionResult } from '@crux/indexer'
import { createMonorepoFixture } from './indexer-benchmark-fixture'
import { projectIndexSnapshotFromAstPatch } from './indexer-benchmark-snapshot'
import { prepareMutation, WATCH_SCENARIOS, type WatchScenarioName } from './indexer-watch-benchmark-scenarios'

interface WatchBenchmarkArgs {
  readonly root: string
  readonly fixture?: 'monorepo'
  readonly packages: number
  readonly filesPerPackage: number
  readonly mode: IncrementalExecutionMode
  readonly copyRoot: boolean
  readonly budgetProfile?: WatchBudgetProfileName
}

interface PreparedRoot {
  readonly root: string
  readonly cleanup?: string
  readonly copied: boolean
}

interface WatchScenarioResult {
  readonly name: string
  readonly target?: string
  readonly skippedReason?: string
  readonly warmAstMs?: number
  readonly incrementalMs?: number
  readonly result?: IncrementalIndexExecutionResult
}

interface WatchScenarioBudget {
  readonly p50TargetMs: number
  readonly p95BudgetMs: number
}

type WatchBudgetProfileName = keyof typeof WATCH_BUDGET_PROFILES

const DEFAULT_BACKEND_ROOT = '/home/henri/private/karyla/packages/backend'
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const WATCH_BUDGET_PROFILES = {
  'karyla-backend': {
    'leaf-prompt-edit': { p50TargetMs: 1800, p95BudgetMs: 2500 },
    'imported-helper-edit': { p50TargetMs: 2400, p95BudgetMs: 3200 },
    'unrelated-helper-edit': { p50TargetMs: 3600, p95BudgetMs: 4800 },
    'config-edit': { p50TargetMs: 3200, p95BudgetMs: 4500 },
    'deleted-file': { p50TargetMs: 3000, p95BudgetMs: 4500 },
  },
} as const satisfies Record<string, Record<WatchScenarioName, WatchScenarioBudget>>
const COPY_EXCLUDED_NAMES = new Set([
  '.cache',
  '.crux',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prepared = prepareRoot(args)
  let budgetFailed = false
  try {
    if (!existsSync(prepared.root)) {
      throw new Error(`Benchmark root does not exist: ${prepared.root}`)
    }
    console.log(`Project Index watch benchmark root: ${prepared.root}`)
    if (prepared.copied) console.log(`source root copied before mutation: ${args.root}`)
    if (args.fixture) {
      console.log(`fixture: ${args.fixture} packages=${args.packages} filesPerPackage=${args.filesPerPackage}`)
    }
    console.log(`mode: ${args.mode}`)

    for (const scenario of WATCH_SCENARIOS) {
      const result = await runWatchScenario(prepared.root, scenario, args.mode)
      printWatchScenario(result, args.budgetProfile ? WATCH_BUDGET_PROFILES[args.budgetProfile][scenario] : undefined)
      if (exceedsBudget(result, args.budgetProfile ? WATCH_BUDGET_PROFILES[args.budgetProfile][scenario] : undefined)) {
        budgetFailed = true
      }
    }
  } finally {
    if (prepared.cleanup) rmSync(prepared.cleanup, { recursive: true, force: true })
  }
  if (budgetFailed) process.exitCode = 1
}

function parseArgs(argv: readonly string[]): WatchBenchmarkArgs {
  const rootFlag = argv.find((arg) => arg.startsWith('--root='))
  const fixtureFlag = argv.find((arg) => arg.startsWith('--fixture='))
  const packagesFlag = argv.find((arg) => arg.startsWith('--packages='))
  const filesPerPackageFlag = argv.find((arg) => arg.startsWith('--files-per-package='))
  const modeFlag = argv.find((arg) => arg.startsWith('--mode='))
  const budgetProfileFlag = argv.find((arg) => arg.startsWith('--budget-profile='))
  const root =
    rootFlag?.slice('--root='.length) ?? (existsSync(DEFAULT_BACKEND_ROOT) ? DEFAULT_BACKEND_ROOT : process.cwd())
  const fixture = fixtureFlag?.slice('--fixture='.length)
  if (fixture !== undefined && fixture !== 'monorepo') {
    throw new Error(`Unsupported benchmark fixture: ${fixture}`)
  }
  return {
    root,
    fixture,
    packages: positiveInteger(packagesFlag?.slice('--packages='.length), 4),
    filesPerPackage: positiveInteger(filesPerPackageFlag?.slice('--files-per-package='.length), 4),
    mode: incrementalMode(modeFlag?.slice('--mode='.length)),
    copyRoot: !argv.includes('--in-place') && fixture === undefined,
    budgetProfile: watchBudgetProfile(budgetProfileFlag?.slice('--budget-profile='.length)),
  }
}

function prepareRoot(args: WatchBenchmarkArgs): PreparedRoot {
  if (args.fixture === 'monorepo') {
    const fixture = createMonorepoFixture(args)
    return { root: fixture.root, cleanup: fixture.root, copied: false }
  }
  const root = resolveBenchmarkRoot(args.root)
  if (!args.copyRoot) return { root, copied: false }
  const tempRoot = mkdtempSync(join(tmpdir(), 'crux-indexer-watch-'))
  const copiedRoot = join(tempRoot, 'project')
  cpSync(root, copiedRoot, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).some((part) => COPY_EXCLUDED_NAMES.has(part)),
  })
  return { root: copiedRoot, cleanup: tempRoot, copied: true }
}

async function runWatchScenario(
  root: string,
  scenario: WatchScenarioName,
  mode: IncrementalExecutionMode,
): Promise<WatchScenarioResult> {
  const warmAstStarted = performance.now()
  const patch = await indexProjectAst({ root, projectName: `watch-benchmark-${scenario}` })
  const warmAstMs = performance.now() - warmAstStarted
  const previousIndex = projectIndexSnapshotFromAstPatch(patch)
  const mutation = prepareMutation(root, scenario, previousIndex)
  if (!mutation) return { name: scenario, warmAstMs, skippedReason: 'no suitable indexed file found' }

  mutation.apply()
  const incrementalStarted = performance.now()
  const result = await indexProjectIncremental({
    root,
    previousIndex,
    files: mutation.deleted ? [] : [mutation.file],
    deletedFiles: mutation.deleted ? [mutation.file] : [],
    mode,
  })
  return {
    name: scenario,
    target: mutation.file,
    warmAstMs,
    incrementalMs: performance.now() - incrementalStarted,
    result,
  }
}

function printWatchScenario(result: WatchScenarioResult, budget: WatchScenarioBudget | undefined): void {
  if (!result.result) {
    console.log(`${result.name}: skipped reason=${result.skippedReason} warmAst=${formatMs(result.warmAstMs)}`)
    return
  }
  const report = result.result.report
  const target = result.target ? relative(process.cwd(), result.target) : 'n/a'
  const budgetStatus = exceedsBudget(result, budget) ? 'fail' : 'pass'
  console.log(
    [
      `${result.name}:`,
      `target=${target}`,
      `warmAst=${formatMs(result.warmAstMs)}`,
      `incremental=${formatMs(result.incrementalMs)}`,
      `plan=${report.planKind}`,
      `fallback=${report.fallbackUsed}`,
      `reason=${report.fallbackReason ?? 'none'}`,
      `graph=${report.graphConfidence}`,
      `patches=${report.patchCounts.ast}/${report.patchCounts.semantic}/${report.patchCounts.total}`,
      `sourceProfiles=${report.sourceProfileFileCount}`,
      `semantic=${report.semanticStatus}`,
      `affectedFiles=${report.affectedFiles.length}`,
      `affectedDefinitions=${report.affectedDefinitionIds.length}`,
      `phaseTimings=${formatPhaseTimings(report.durationMsByPhase)}`,
      ...(budget ? [`budget=${budgetStatus}/${budget.p95BudgetMs}ms`] : []),
    ].join(' '),
  )
}

function exceedsBudget(result: WatchScenarioResult, budget: WatchScenarioBudget | undefined): boolean {
  return budget !== undefined && result.incrementalMs !== undefined && result.incrementalMs > budget.p95BudgetMs
}

function formatPhaseTimings(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return 'none'
  return entries.map(([name, value]) => `${name}:${value.toFixed(1)}ms`).join(',')
}

function formatMs(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value.toFixed(1)}ms`
}

function resolveBenchmarkRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(WORKSPACE_ROOT, root)
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`)
  }
  return parsed
}

function incrementalMode(value: string | undefined): IncrementalExecutionMode {
  if (value === undefined || value === 'ast-and-semantic') return 'ast-and-semantic'
  if (value === 'ast') return 'ast'
  throw new Error(`Unsupported watch benchmark mode: ${value}`)
}

function watchBudgetProfile(value: string | undefined): WatchBudgetProfileName | undefined {
  if (value === undefined) return undefined
  if (value in WATCH_BUDGET_PROFILES) return value as WatchBudgetProfileName
  throw new Error(`Unsupported watch benchmark budget profile: ${value}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
