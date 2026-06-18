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

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { indexProjectAst, indexProjectSemantic } from '@crux/indexer'
import type { IndexPatch } from '@crux/indexer'

interface BenchmarkArgs {
  readonly root: string
  readonly fixture?: 'monorepo'
  readonly packages: number
  readonly filesPerPackage: number
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
  readonly rssMb: number
  readonly ast: PatchBenchmarkResult
  readonly semantic: PatchBenchmarkResult
  readonly semanticTimings: readonly SemanticTiming[]
}

const DEFAULT_BACKEND_ROOT = '/home/henri/private/karyla/packages/backend'
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SEMANTIC_TIMING_ORDER = [
  'semantic.selection',
  'semantic.preflight',
  'semantic.cache.read',
  'semantic.program.create',
  'semantic.checker.create',
  'semantic.analyzer.execution',
  'semantic.merge',
  'semantic.cache.write',
  'semantic.patch.serialization',
]

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
    console.log('mode: AST + semantic patches')

    const cold = await runPass('cold', root)
    const warm = await runPass('warm', root)

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
  }
}

function resolveBenchmarkRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(WORKSPACE_ROOT, root)
}

async function runPass(label: string, root: string): Promise<BenchmarkResult> {
  const passStarted = performance.now()
  const astStarted = performance.now()
  const patch = await indexProjectAst({ root, projectName: `benchmark-${label}` })
  const astElapsedMs = performance.now() - astStarted
  const ast = resultFromPatch(astElapsedMs, patch)

  const semanticTimings: SemanticTiming[] = []
  const semanticStarted = performance.now()
  const semanticPatch = await indexProjectSemantic({
    root,
    projectName: `benchmark-${label}`,
    semanticInstrumentation: {
      onTiming: (timing) => semanticTimings.push(timing),
    },
  })
  const semanticElapsedMs = performance.now() - semanticStarted
  const semantic = resultFromPatch(semanticElapsedMs, semanticPatch)
  semanticTimings.push({ name: 'semantic.patch.serialization', durationMs: semantic.serializationMs })

  const elapsedMs = performance.now() - passStarted
  const rssMb = process.memoryUsage().rss / 1024 / 1024
  return { label, elapsedMs, rssMb, ast, semantic, semanticTimings }
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
  console.log(`${result.label}: total=${result.elapsedMs.toFixed(1)}ms rss=${result.rssMb.toFixed(1)}MB`)
  printPatchResult('ast', result.ast)
  printPatchResult('semantic', result.semantic)
  for (const name of SEMANTIC_TIMING_ORDER) {
    const durationMs = result.semanticTimings
      .filter((timing) => timing.name === name)
      .reduce((sum, timing) => sum + timing.durationMs, 0)
    console.log(`  ${name}=${durationMs > 0 ? `${durationMs.toFixed(1)}ms` : 'n/a'}`)
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

function createMonorepoFixture(args: BenchmarkArgs): { readonly root: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'crux-indexer-monorepo-'))
  writeFileSync(rootPath(root, 'package.json'), JSON.stringify({ name: '@fixture/benchmark', private: true }, null, 2))
  writeFileSync(rootPath(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')

  for (let packageIndex = 0; packageIndex < args.packages; packageIndex += 1) {
    const packageRoot = rootPath(root, `packages/pkg-${packageIndex}`)
    mkdirSync(rootPath(packageRoot, 'src'), { recursive: true })
    writeFileSync(
      rootPath(packageRoot, 'package.json'),
      JSON.stringify({ name: `@fixture/pkg-${packageIndex}` }, null, 2),
    )
    writeFileSync(rootPath(packageRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }, null, 2))
    for (let fileIndex = 0; fileIndex < args.filesPerPackage; fileIndex += 1) {
      writeFileSync(
        rootPath(packageRoot, `src/prompt-${fileIndex}.ts`),
        [
          "import { prompt } from '@crux/core'",
          '',
          `export const prompt${fileIndex} = prompt({`,
          `  id: 'pkg-${packageIndex}.prompt-${fileIndex}',`,
          `  system: 'Package ${packageIndex} prompt ${fileIndex}.',`,
          "  prompt: 'Draft the response.',",
          '})',
          '',
        ].join('\n'),
      )
    }
  }

  return { root }
}

function rootPath(root: string, path: string): string {
  return resolve(root, path)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
