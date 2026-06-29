#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseArgs(process.argv.slice(2))
const baseVersion = options.baseVersion ?? (await readCoreVersion())
const shortSha = options.sha ?? readGitSha()
const timestamp = options.timestamp ?? utcTimestamp(new Date())
const version = createNightlyVersion(baseVersion, timestamp, shortSha)

await writeGitHubOutput({
  version,
  sha: shortSha,
  npm_tag: 'nightly',
})

console.log(version)

function parseArgs(args) {
  const parsed = {
    baseVersion: undefined,
    sha: undefined,
    timestamp: undefined,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--base-version') {
      parsed.baseVersion = args[++index]
    } else if (arg === '--sha') {
      parsed.sha = normalizeSha(args[++index])
    } else if (arg === '--timestamp') {
      parsed.timestamp = args[++index]
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit()
    } else if (arg === '--') {
      continue
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/create-nightly-version.mjs [options]

Options:
  --base-version <version>  Stable semver version to bump from. Default: packages/core version.
  --sha <sha>              Git SHA to include. Default: current HEAD.
  --timestamp <timestamp>  UTC timestamp identifier. Default: current UTC time.
`)
  process.exit(0)
}

async function readCoreVersion() {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'packages/core/package.json'), 'utf8'))
  if (!manifest.version) throw new Error('packages/core/package.json does not define a version.')
  return manifest.version
}

function createNightlyVersion(baseVersion, timestamp, sha) {
  const match = baseVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?(?:\+.+)?$/)
  if (!match) throw new Error(`Cannot create nightly version from invalid base version: ${baseVersion}`)

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3]) + 1
  return `${major}.${minor}.${patch}-nightly.${timestamp}.sha${sha}`
}

function readGitSha() {
  if (process.env.GITHUB_SHA) return normalizeSha(process.env.GITHUB_SHA)

  const result = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) throw new Error(`git rev-parse failed\n${result.stderr.trim()}`)
  return normalizeSha(result.stdout.trim())
}

function normalizeSha(sha) {
  const normalized = sha.trim().slice(0, 7)
  if (!/^[0-9a-f]{7}$/i.test(normalized)) throw new Error(`Invalid git SHA for nightly version: ${sha}`)
  return normalized.toLowerCase()
}

function utcTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('')
}

async function writeGitHubOutput(outputs) {
  if (!process.env.GITHUB_OUTPUT) return
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}
