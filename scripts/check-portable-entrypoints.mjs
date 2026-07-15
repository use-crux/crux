#!/usr/bin/env node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPortableEntrypoints } from './portability/check.mjs'
import { loadPortabilityContext } from './portability/matrix.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stageRoot = parseStageRoot(process.argv.slice(2))
const context = await loadPortabilityContext(repoRoot, { stageRoot })
const result = await checkPortableEntrypoints(context)

console.log(`Checked ${result.checked} ${context.mode} portable entrypoint(s).`)

function parseStageRoot(args) {
  if (args.length === 0) return undefined
  if (args.length === 2 && args[0] === '--stage-root') return args[1]
  throw new Error('Usage: node scripts/check-portable-entrypoints.mjs [--stage-root <dir>]')
}
