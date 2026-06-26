#!/usr/bin/env node

/**
 * Native AST benchmark runner.
 *
 * The runner builds the release Rust/Oxc worker and fresh embedded TypeScript
 * worker assets before invoking the Go Project Index benchmarks via `go test`.
 * Benchmark
 * output is left in Go's native format so callers can archive or compare it
 * with `benchstat`.
 *
 * Environment:
 *
 * - `CRUX_INDEXER_BENCH_ROOT`: project root to benchmark. Defaults to this repo.
 * - `CRUX_INDEXER_BENCH_MODES`: comma-separated benchmark profiles.
 * - `CRUX_INDEXER_BENCH_COUNT`: Go benchmark repetition count. Defaults to `3`.
 * - `CRUX_INDEXER_BENCH_BENCH`: Go benchmark regexp. Defaults to the AST and graph benchmarks.
 * - `CRUX_INDEXER_BENCH_TIMEOUT`: Go test timeout. Defaults to `30m`.
 * - `CRUX_INDEXER_BENCH_BENCHTIME`: optional Go `-benchtime` value.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const localPackageRoot = resolve(repoRoot, 'packages', 'local')
const workerBinaryName = process.platform === 'win32' ? 'crux-indexer-worker.exe' : 'crux-indexer-worker'
const workerPath = resolve(repoRoot, 'target', 'release', workerBinaryName)
const benchmarkRoot = resolve(process.env.CRUX_INDEXER_BENCH_ROOT ?? repoRoot)
const benchmarkPattern =
  process.env.CRUX_INDEXER_BENCH_BENCH ?? 'BenchmarkWorker(IndexProjectAstPatch|ReindexProjectGraphPipeline)$'
const benchmarkCount = process.env.CRUX_INDEXER_BENCH_COUNT ?? '3'
const benchmarkTimeout = process.env.CRUX_INDEXER_BENCH_TIMEOUT ?? '30m'
const benchmarkTime = process.env.CRUX_INDEXER_BENCH_BENCHTIME

/**
 * @typedef {'js-cold' | 'js-warm' | 'native-cold' | 'native-warm'} BenchmarkProfileName
 *
 * @typedef {Readonly<{
 *   name: BenchmarkProfileName
 *   description: string
 *   nativeAst: boolean
 *   clearCache: boolean
 * }>} BenchmarkProfile
 *
 * @typedef {Readonly<{
 *   label: string
 *   command: string
 *   args: readonly string[]
 *   cwd?: string
 *   env?: Readonly<Record<string, string>>
 * }>} BenchmarkCommand
 */

/** @type {Readonly<Record<BenchmarkProfileName, BenchmarkProfile>>} */
const benchmarkProfiles = {
  'js-cold': {
    name: 'js-cold',
    description: 'TypeScript baseline with index cache cleared before each benchmark iteration',
    nativeAst: false,
    clearCache: true,
  },
  'js-warm': {
    name: 'js-warm',
    description: 'TypeScript baseline with normal warm-cache behavior',
    nativeAst: false,
    clearCache: false,
  },
  'native-cold': {
    name: 'native-cold',
    description: 'Native AST path with index cache cleared before each benchmark iteration',
    nativeAst: true,
    clearCache: true,
  },
  'native-warm': {
    name: 'native-warm',
    description: 'Native AST path with normal warm-cache behavior',
    nativeAst: true,
    clearCache: false,
  },
}

/** @type {readonly BenchmarkProfile[]} */
const selectedProfiles = parseBenchmarkProfiles(
  process.env.CRUX_INDEXER_BENCH_MODES ?? 'js-cold,native-cold,js-warm,native-warm',
)

if (!existsSync(benchmarkRoot)) {
  throw new Error(`CRUX_INDEXER_BENCH_ROOT does not exist: ${benchmarkRoot}`)
}

console.log(`Native AST benchmark root: ${benchmarkRoot}`)
console.log(`Go benchmark pattern: ${benchmarkPattern}`)
console.log(`Profiles: ${selectedProfiles.map((profile) => profile.name).join(', ')}`)

run({
  label: 'Build release Rust/Oxc Static Index worker',
  command: 'cargo',
  args: ['build', '--release', '--package', 'crux-indexer-worker', '--bin', 'crux-indexer-worker'],
})
assertWorkerExists()

run({
  label: 'Build devtools worker bundle for Go host benchmarks',
  command: 'pnpm',
  args: ['--filter', '@use-crux/devtools', 'run', 'build:workers'],
})

run({
  label: 'Embed devtools workers for Go host benchmarks',
  command: 'make',
  args: ['embed-workers'],
  cwd: localPackageRoot,
})

for (const profile of selectedProfiles) {
  runGoBenchmark(profile)
}

/**
 * Parses the configured benchmark profile list.
 *
 * @param {string} raw - Comma-separated profile names.
 * @returns {readonly BenchmarkProfile[]} Profiles in execution order.
 */
function parseBenchmarkProfiles(raw) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => {
      if (isBenchmarkProfileName(name)) return benchmarkProfiles[name]
      throw new Error(
        `Unknown CRUX_INDEXER_BENCH_MODES profile "${name}". Expected one of: ${Object.keys(benchmarkProfiles).join(', ')}`,
      )
    })
}

/**
 * Narrows arbitrary strings to supported benchmark profile names.
 *
 * @param {string} name - Candidate profile name.
 * @returns {name is BenchmarkProfileName}
 */
function isBenchmarkProfileName(name) {
  return Object.hasOwn(benchmarkProfiles, name)
}

/**
 * Runs the Go benchmark suite for one JS/native and cold/warm profile.
 *
 * @param {BenchmarkProfile} profile - Benchmark profile to execute.
 */
function runGoBenchmark(profile) {
  const args = [
    'test',
    './internal/projectindex/host',
    '-run',
    '^$',
    '-bench',
    benchmarkPattern,
    '-benchmem',
    '-count',
    benchmarkCount,
    '-timeout',
    benchmarkTimeout,
  ]
  if (benchmarkTime) args.push('-benchtime', benchmarkTime)

  console.log(`\nProfile: ${profile.name}`)
  console.log(profile.description)

  run({
    label: `Run Go Project Index benchmark (${profile.name})`,
    command: 'go',
    args,
    cwd: localPackageRoot,
    env: {
      CRUX_STATIC_INDEX_WORKER: workerPath,
      CRUX_INDEXER_BENCH_ROOT: benchmarkRoot,
      CRUX_INDEXER_BENCH_NATIVE_AST: profile.nativeAst ? '1' : '0',
      CRUX_INDEXER_BENCH_CLEAR_CACHE: profile.clearCache ? '1' : '0',
    },
  })
}

/**
 * Runs one command with inherited stdio.
 *
 * @param {BenchmarkCommand} item - Command descriptor to execute.
 */
function run(item) {
  console.log(`\n==> ${item.label}`)
  const result = spawnSync(item.command, item.args, {
    cwd: item.cwd ?? repoRoot,
    env: { ...process.env, ...item.env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

/** Throws if the release worker binary expected by the benchmarks was not produced. */
function assertWorkerExists() {
  if (existsSync(workerPath)) return
  throw new Error(`Native AST benchmark expected Rust worker at ${workerPath}`)
}
