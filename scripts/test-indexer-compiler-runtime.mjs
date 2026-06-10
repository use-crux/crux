#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const testFiles = [
  '__tests__/semantic-analyzers.test.ts',
  '__tests__/semantic-runner.test.ts',
  '__tests__/static-extraction-engine.test.ts',
  '__tests__/compiler.test.ts',
  '__tests__/compiler-diagnostics.test.ts',
  '__tests__/project-indexer.test.ts',
  '__tests__/incremental-executor.test.ts',
]

const result = spawnSync('pnpm', ['exec', 'vitest', 'run', ...testFiles], {
  cwd: new URL('../packages/indexer/', import.meta.url),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(result.status ?? 1)
