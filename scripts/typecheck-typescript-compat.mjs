#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const mode = process.argv[2]

if (!mode) {
  console.error('Usage: node ./scripts/typecheck-typescript-compat.mjs <5.5.4|6.0.3|tsgo>')
  process.exit(1)
}

const stablePackages = [
  'packages/core',
  'packages/ai',
  'packages/anthropic',
  'packages/convex',
  'packages/google',
  'packages/indexer',
  'packages/ingest',
  'packages/openai',
  'packages/otel',
  'packages/react',
  'packages/upstash',
]

const tsgoPreviewPackages = stablePackages.filter((packageDir) => packageDir !== 'packages/indexer')
const packages = mode === 'tsgo' ? tsgoPreviewPackages : stablePackages

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

for (const packageDir of packages) {
  console.log(`\n> ${mode} ${packageDir}`)

  if (mode === 'tsgo') {
    run('pnpm', ['exec', 'tsgo', '-p', `${packageDir}/tsconfig.json`, '--noEmit', '--pretty', 'false'])
    continue
  }

  run('pnpm', [
    'dlx',
    '--package',
    `typescript@${mode}`,
    'tsc',
    '-p',
    `${packageDir}/tsconfig.json`,
    '--noEmit',
    '--pretty',
    'false',
  ])
}
