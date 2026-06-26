#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseArgs(process.argv.slice(2))
const repoRoot = resolve(options.repoRoot ?? scriptRoot)
const version = options.version ?? (await readReleaseVersion())
const tag = options.tag ?? `v${version}`
const changelog = await readFile(resolve(repoRoot, 'CHANGELOG.md'), 'utf8')
const notes = extractVersionSection(changelog, version)

if (!notes) throw new Error(`CHANGELOG.md does not contain a ${version} release section.`)

const notesPath = resolve(repoRoot, options.out)
await mkdir(dirname(notesPath), { recursive: true })
await writeFile(notesPath, `${notes.trim()}\n`)
await writeGitHubOutput({ version, tag, notes_file: options.out })

console.log(`Wrote GitHub release notes for ${tag} to ${options.out}`)

function parseArgs(args) {
  const parsed = {
    repoRoot: undefined,
    version: undefined,
    tag: undefined,
    out: '.tmp/github-release-notes.md',
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--repo-root') {
      parsed.repoRoot = args[++index]
    } else if (arg === '--version') {
      parsed.version = args[++index]
    } else if (arg === '--tag') {
      parsed.tag = args[++index]
    } else if (arg === '--out') {
      parsed.out = args[++index]
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
  console.log(`Usage: node scripts/write-github-release-notes.mjs [options]

Options:
  --repo-root <dir>    Repository root to read. Default: current script's repo root.
  --version <version>  Version section to extract. Default: packages/core version.
  --tag <tag>          GitHub release tag. Default: v<version>.
  --out <file>         Notes output file. Default: .tmp/github-release-notes.md.
`)
  process.exit(0)
}

async function readReleaseVersion() {
  const manifest = JSON.parse(await readFile(resolve(repoRoot, 'packages/core/package.json'), 'utf8'))
  if (!manifest.version) throw new Error('packages/core/package.json does not define a version.')
  return manifest.version
}

function extractVersionSection(content, version) {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start === -1) return undefined

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index
      break
    }
  }

  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
}

async function writeGitHubOutput(outputs) {
  if (!process.env.GITHUB_OUTPUT) return
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}
