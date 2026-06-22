#!/usr/bin/env tsx

/**
 * Cold/warm Project Index benchmark for local architecture work.
 *
 * Runs two AST + semantic indexing passes in one process and reports elapsed
 * time, RSS, patch size, and semantic phase timing. The first pass approximates
 * a cold worker process; the second pass shows warm in-process parser/cache
 * behavior.
 *
 * @module
 */

import { existsSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { indexProjectAst, indexProjectSemantic } from '@crux/indexer'
import type { IndexPatch, SemanticBackendName, SemanticBackendSelection, StaticExtractionTimingName } from '@crux/indexer'
import { SEMANTIC_TIMING_ORDER, STATIC_TIMING_ORDER, printTimingSummary } from './indexer-benchmark-timings'
import { formatNativeCoverage, type NativeCoverageSummary } from './indexer-benchmark-coverage'
import { createMonorepoFixture } from './indexer-benchmark-fixture'
import { projectIndexSnapshotFromAstPatch } from './indexer-benchmark-snapshot'
import { measureProcessTreeMemoryDuring } from './process-memory'

interface BenchmarkArgs {
  readonly root: string
  readonly fixture?: 'monorepo'
  readonly packages: number
  readonly filesPerPackage: number
  readonly semanticBackends: readonly SemanticBackendName[]
}

interface PatchBenchmarkResult {
  readonly status: IndexPatch['status']
  readonly elapsedMs: number
  readonly bytes: number
  readonly serializationMs: number
  readonly definitions: number
  readonly relations: number
  readonly diagnostics: number
  readonly sources: number
  readonly shards: number
  readonly shardSourceRows: number
}

interface SemanticTiming {
  readonly name: string
  readonly durationMs: number
}

interface BenchmarkResult {
  readonly label: string
  readonly elapsedMs: number
  readonly rssStartMb: number
  readonly rssEndMb: number
  readonly rssPeakMb: number
  readonly ast: PatchBenchmarkResult
  readonly staticTimings: readonly StaticTiming[]
  readonly semantics: readonly SemanticBenchmarkResult[]
}

interface StaticTiming {
  readonly name: StaticExtractionTimingName
  readonly durationMs: number
}

interface SemanticBenchmarkResult {
  readonly backend: SemanticBackendName
  readonly patch: PatchBenchmarkResult
  readonly timings: readonly SemanticTiming[]
  readonly nativeCoverage: readonly NativeCoverageSummary[]
}

const DEFAULT_BACKEND_ROOT = '/home/henri/private/karyla/packages/backend'
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const fixture = args.fixture === 'monorepo' ? createMonorepoFixture(args) : undefined
  const root = fixture?.root ?? resolveBenchmarkRoot(args.root)
  try {
    if (!existsSync(root)) {
      throw new Error(`Benchmark root does not exist: ${root}`)
    }

    console.log(`Project Index benchmark root: ${root}`)
    if (fixture) {
      console.log(`fixture: monorepo packages=${args.packages} filesPerPackage=${args.filesPerPackage}`)
    }
    console.log(`mode: AST + semantic patches backends=${args.semanticBackends.join(',')}`)

    const cold = await runPass('cold', root, args.semanticBackends)
    const warm = await runPass('warm', root, args.semanticBackends)

    printResult(cold)
    printResult(warm)
  } finally {
    if (fixture) rmSync(fixture.root, { recursive: true, force: true })
  }
}

function parseArgs(argv: readonly string[]): BenchmarkArgs {
  const rootFlag = argv.find((arg) => arg.startsWith('--root='))
  const fixtureFlag = argv.find((arg) => arg.startsWith('--fixture='))
  const packagesFlag = argv.find((arg) => arg.startsWith('--packages='))
  const filesPerPackageFlag = argv.find((arg) => arg.startsWith('--files-per-package='))
  const semanticBackendFlag = argv.find((arg) => arg.startsWith('--semantic-backend='))
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
    semanticBackends: semanticBackends(semanticBackendFlag?.slice('--semantic-backend='.length)),
  }
}

function resolveBenchmarkRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(WORKSPACE_ROOT, root)
}

async function runPass(
  label: string,
  root: string,
  semanticBackends: readonly SemanticBackendName[],
): Promise<BenchmarkResult> {
  const passStarted = performance.now()
  const { value, memory } = await measureProcessTreeMemoryDuring(async () => {
    const staticTimings: StaticTiming[] = []
    const astStarted = performance.now()
    const patch = await indexProjectAst({
      root,
      projectName: `benchmark-${label}`,
      staticInstrumentation: {
        onTiming: (timing) => staticTimings.push(timing),
      },
    })
    const astElapsedMs = performance.now() - astStarted
    const ast = resultFromPatch(astElapsedMs, patch)

    const semantics: SemanticBenchmarkResult[] = []
    for (const backend of semanticBackends) {
      const semanticTimings: SemanticTiming[] = []
      const nativeCoverage: NativeCoverageSummary[] = []
      const semanticStarted = performance.now()
      const semanticPatch = await indexProjectSemantic({
        root,
        projectName: `benchmark-${label}-${backend}`,
        semanticBackend: semanticBackendSelection(backend),
        previousIndex: projectIndexSnapshotFromAstPatch(patch),
        semanticSourceProfile: patch.semanticSourceProfile,
        semanticInstrumentation: {
          onTiming: (timing) => semanticTimings.push(timing),
          onNativeCoverage: (coverage) =>
            nativeCoverage.push({
              kind: coverage.kind,
              ...('extractors' in coverage ? { extractors: coverage.extractors } : {}),
              ...('reason' in coverage ? { reason: coverage.reason } : {}),
            }),
        },
      })
      const semanticElapsedMs = performance.now() - semanticStarted
      const semantic = resultFromPatch(semanticElapsedMs, semanticPatch)
      semanticTimings.push({ name: 'semantic.patch.serialization', durationMs: semantic.serializationMs })
      semantics.push({ backend, patch: semantic, timings: semanticTimings, nativeCoverage })
    }

    return { ast, semantics, staticTimings }
  })
  const elapsedMs = performance.now() - passStarted
  return {
    label,
    elapsedMs,
    rssStartMb: memory.rssStartMb,
    rssEndMb: memory.rssEndMb,
    rssPeakMb: memory.rssPeakMb,
    ast: value.ast,
    staticTimings: value.staticTimings,
    semantics: value.semantics,
  }
}

function resultFromPatch(elapsedMs: number, patch: IndexPatch): PatchBenchmarkResult {
  const serializationStarted = performance.now()
  const serialized = JSON.stringify(patch)
  const serializationMs = performance.now() - serializationStarted
  return {
    status: patch.status,
    elapsedMs,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    serializationMs,
    definitions: patch.facts.definitions?.length ?? 0,
    relations: patch.facts.relations?.length ?? 0,
    diagnostics: patch.facts.diagnostics?.length ?? 0,
    sources: patch.facts.sources?.length ?? 0,
    shards: patch.facts.sourceGraph?.shards?.length ?? 0,
    shardSourceRows: patch.facts.sources?.filter((source) => source.shardId).length ?? 0,
  }
}

function printResult(result: BenchmarkResult): void {
  console.log(
    [
      `${result.label}:`,
      `total=${result.elapsedMs.toFixed(1)}ms`,
      `treeRssStart=${result.rssStartMb.toFixed(1)}MB`,
      `treeRssEnd=${result.rssEndMb.toFixed(1)}MB`,
      `treeRssPeak=${result.rssPeakMb.toFixed(1)}MB`,
    ].join(' '),
  )
  printPatchResult('ast', result.ast)
  printTimingSummary('ast', result.staticTimings, STATIC_TIMING_ORDER)
  for (const semantic of result.semantics) {
    printPatchResult(`semantic[${semantic.backend}]`, semantic.patch)
    if (semantic.nativeCoverage.length > 0) {
      console.log(`  ${semantic.backend}.native.coverage=${formatNativeCoverage(semantic.nativeCoverage)}`)
    }
    printTimingSummary(semantic.backend, semantic.timings, SEMANTIC_TIMING_ORDER)
  }
}

function printPatchResult(label: string, result: PatchBenchmarkResult): void {
  console.log(
    [
      `  ${label}:`,
      `status=${result.status}`,
      `elapsed=${result.elapsedMs.toFixed(1)}ms`,
      `serialization=${result.serializationMs.toFixed(1)}ms`,
      `bytes=${result.bytes}`,
      `definitions=${result.definitions}`,
      `relations=${result.relations}`,
      `diagnostics=${result.diagnostics}`,
      `sources=${result.sources}`,
      `shards=${result.shards}`,
      `shardSources=${result.shardSourceRows}`,
    ].join(' '),
  )
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`)
  }
  return parsed
}

function semanticBackends(value: string | undefined): readonly SemanticBackendName[] {
  if (value === undefined || value === 'typescript') {
    return ['typescript']
  }
  if (value === 'native') {
    return ['native']
  }
  if (value === 'both') {
    return ['typescript', 'native']
  }
  throw new Error(`Unsupported semantic backend: ${value}`)
}

function semanticBackendSelection(backend: SemanticBackendName): SemanticBackendSelection {
  return backend === 'native' ? { name: 'native' } : backend
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
