#!/usr/bin/env node

import { resolve } from 'node:path'
import { runRuntimeWorkerProcess } from '../lib/runtime-worker/process'

const root = resolve(process.argv[2] ?? process.cwd())

try {
  await runRuntimeWorkerProcess(root)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
