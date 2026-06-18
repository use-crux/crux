#!/usr/bin/env tsx

/**
 * Cold/warm Project Index benchmark for local architecture work.
 *
 * Runs two source-only AST indexing passes in one process and reports elapsed
 * time, RSS, and patch size. The first pass approximates a cold worker process;
 * the second pass shows warm in-process parser/cache behavior.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { indexProjectAst } from '@crux/indexer'
import type { IndexPatch } from '@crux/indexer'

interface BenchmarkArgs {
  readonly root: string
}

interface BenchmarkResult {
  readonly label: string
  readonly elapsedMs: number
  readonly rssMb: number
  readonly bytes: number
  readonly definitions: number
  readonly relations: number
  readonly diagnostics: number
  readonly sources: number
}

const DEFAULT_BACKEND_ROOT = '/home/henri/private/karyla/packages/backend'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root)
  if (!existsSync(root)) {
    throw new Error(`Benchmark root does not exist: ${root}`)
  }

  console.log(`Project Index benchmark root: ${root}`)
  console.log('mode: source-only AST patch')

  const cold = await runPass('cold', root)
  const warm = await runPass('warm', root)

  printResult(cold)
  printResult(warm)
}

function parseArgs(argv: readonly string[]): BenchmarkArgs {
  const rootFlag = argv.find((arg) => arg.startsWith('--root='))
  const root =
    rootFlag?.slice('--root='.length) ?? (existsSync(DEFAULT_BACKEND_ROOT) ? DEFAULT_BACKEND_ROOT : process.cwd())
  return { root }
}

async function runPass(label: string, root: string): Promise<BenchmarkResult> {
  const started = performance.now()
  const patch = await indexProjectAst({ root, projectName: `benchmark-${label}` })
  const elapsedMs = performance.now() - started
  const rssMb = process.memoryUsage().rss / 1024 / 1024
  return resultFromPatch(label, elapsedMs, rssMb, patch)
}

function resultFromPatch(label: string, elapsedMs: number, rssMb: number, patch: IndexPatch): BenchmarkResult {
  return {
    label,
    elapsedMs,
    rssMb,
    bytes: Buffer.byteLength(JSON.stringify(patch), 'utf8'),
    definitions: patch.facts.definitions?.length ?? 0,
    relations: patch.facts.relations?.length ?? 0,
    diagnostics: patch.facts.diagnostics?.length ?? 0,
    sources: patch.facts.sources?.length ?? 0,
  }
}

function printResult(result: BenchmarkResult): void {
  console.log(
    [
      `${result.label}:`,
      `${result.elapsedMs.toFixed(1)}ms`,
      `rss=${result.rssMb.toFixed(1)}MB`,
      `bytes=${result.bytes}`,
      `definitions=${result.definitions}`,
      `relations=${result.relations}`,
      `diagnostics=${result.diagnostics}`,
      `sources=${result.sources}`,
    ].join(' '),
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
