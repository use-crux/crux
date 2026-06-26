#!/usr/bin/env node

/**
 * Native AST parity gate for CI and release checks.
 *
 * The gate builds the Rust/Oxc worker first and then passes its absolute path
 * to every parity command. This makes missing-worker setups fail loudly instead
 * of silently skipping native checks.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workerPath = resolve(repoRoot, 'target', 'debug', process.platform === 'win32' ? 'crux-indexer-worker.exe' : 'crux-indexer-worker')
const localPackageRoot = resolve(repoRoot, 'packages', 'local')

/**
 * @typedef {Readonly<{
 *   label: string
 *   command: string
 *   args: readonly string[]
 *   cwd?: string
 *   env?: Readonly<Record<string, string>>
 * }>} ParityCommand
 */

/** Environment passed to every worker-backed parity command. */
const workerEnv = {
  CRUX_STATIC_INDEX_WORKER: workerPath,
}

/** Environment that turns Go env-gated parity tests from local skips into CI failures. */
const requiredGoParityEnv = {
  ...workerEnv,
  CRUX_INDEXER_PARITY_ROOT: repoRoot,
  CRUX_INDEXER_PARITY_REQUIRED: '1',
}

/** @type {readonly ParityCommand[]} */
const commands = [
  {
    label: 'Build Rust/Oxc Static Index worker',
    command: 'cargo',
    args: ['build', '--package', 'crux-indexer-worker', '--bin', 'crux-indexer-worker'],
  },
  {
    label: 'Run Rust Static Index tests',
    command: 'cargo',
    args: ['test'],
  },
  {
    label: 'Run full indexer suite with Rust worker',
    command: 'pnpm',
    args: ['--filter', '@use-crux/indexer', 'test'],
    env: workerEnv,
  },
  {
    label: 'Run devtools static parity over repository corpus',
    command: 'pnpm',
    args: [
      '--filter',
      '@use-crux/devtools',
      'parity:indexer-static',
      '--',
      `--root=${repoRoot}`,
      '--concurrency=8',
      '--max-mismatches=20',
    ],
    env: workerEnv,
  },
  {
    label: 'Run Go Project Index parity packages',
    command: 'go',
    args: ['test', './internal/projectindex/...', '-count=1'],
    cwd: localPackageRoot,
    env: requiredGoParityEnv,
  },
]

for (const item of commands) {
  run(item)
  if (item.label === 'Build Rust/Oxc Static Index worker') assertWorkerExists()
}

/**
 * Runs one parity command with inherited stdio.
 *
 * @param {ParityCommand} item - Command descriptor to execute.
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

/** Throws if the Rust worker build did not produce the binary used by parity tests. */
function assertWorkerExists() {
  if (existsSync(workerPath)) return
  throw new Error(`Native AST parity gate expected Rust worker at ${workerPath}`)
}
