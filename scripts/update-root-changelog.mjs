#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseArgs(process.argv.slice(2))
const repoRoot = resolve(options.repoRoot ?? scriptRoot)
const changelogPath = join(repoRoot, 'CHANGELOG.md')
const releaseVersion = await readReleaseVersion()
const releaseSections = await collectReleaseSections(releaseVersion)
const entry = formatRootEntry(releaseVersion, releaseSections)

await writeRootChangelog(entry, releaseVersion)

console.log(`Updated CHANGELOG.md for ${releaseVersion}`)

function parseArgs(args) {
  const parsed = {
    repoRoot: undefined,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--repo-root') {
      parsed.repoRoot = args[++index]
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
  console.log(`Usage: node scripts/update-root-changelog.mjs [options]

Options:
  --repo-root <dir>    Repository root to update. Default: current script's repo root.
`)
  process.exit(0)
}

async function readReleaseVersion() {
  const manifest = await readJson(join(repoRoot, 'packages/core/package.json'))
  if (!manifest.version) throw new Error('packages/core/package.json does not define a version.')
  return manifest.version
}

async function collectReleaseSections(version) {
  const sections = new Map()
  const changelogs = await discoverPackageChangelogs()

  for (const changelog of changelogs) {
    const content = await readFile(changelog, 'utf8')
    const releaseBody = extractVersionSection(content, version)
    if (!releaseBody) continue

    for (const section of parsePackageReleaseSections(releaseBody)) {
      const title = rootSectionTitle(section.title)
      if (!sections.has(title)) sections.set(title, new Map())

      const entries = sections.get(title)
      for (const entry of section.entries) {
        if (isDependencyOnlyEntry(entry)) continue
        entries.set(normalizeEntry(entry), entry)
      }
    }
  }

  return [...sections.entries()]
    .map(([title, entries]) => [title, [...entries.values()]])
    .filter(([, entries]) => entries.length > 0)
}

async function discoverPackageChangelogs() {
  const packageDirs = [
    ...(await listPackageDirs(join(repoRoot, 'packages'))),
    ...(await listPackageDirs(join(repoRoot, 'packages/local/npm'))),
  ]

  const changelogs = []
  for (const packageDir of packageDirs) {
    const manifestPath = join(packageDir, 'package.json')
    const changelog = join(packageDir, 'CHANGELOG.md')
    if (!existsSync(manifestPath) || !existsSync(changelog)) continue

    const manifest = await readJson(manifestPath)
    if (typeof manifest.name === 'string' && manifest.name.startsWith('@use-crux/')) {
      changelogs.push(changelog)
    }
  }

  return changelogs.sort((left, right) => left.localeCompare(right))
}

async function listPackageDirs(root) {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
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

function parsePackageReleaseSections(body) {
  const lines = body.split(/\r?\n/)
  const sections = []
  let current = undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const heading = line.match(/^###\s+(.+?)\s*$/)
    if (heading) {
      current = { title: heading[1], entries: [] }
      sections.push(current)
      continue
    }

    if (!current || !line.startsWith('- ')) continue

    const entryLines = [cleanBulletLine(line)]
    while (index + 1 < lines.length && !lines[index + 1].startsWith('- ') && !/^###\s+/.test(lines[index + 1])) {
      index += 1
      entryLines.push(lines[index])
    }

    current.entries.push(trimBlankLines(entryLines).join('\n'))
  }

  return sections
}

function cleanBulletLine(line) {
  return line.replace(/^-\s+[0-9a-f]{7,}:\s+/i, '- ')
}

function rootSectionTitle(title) {
  if (title === 'Major Changes') return 'Breaking Changes'
  if (title === 'Minor Changes') return 'Highlights'
  if (title === 'Patch Changes') return 'Fixes'
  return title
}

function isDependencyOnlyEntry(entry) {
  return /^-\s+Updated dependencies\b/i.test(entry)
}

function normalizeEntry(entry) {
  return entry
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function trimBlankLines(lines) {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[0].trim() === '') trimmed.shift()
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
  return trimmed
}

function formatRootEntry(version, sections) {
  const body =
    sections.length > 0
      ? sections.map(([title, entries]) => [`### ${title}`, '', entries.join('\n\n')].join('\n')).join('\n\n')
      : '### Highlights\n\n- Release synchronized `@use-crux` packages.'

  return `## ${version}\n\n${body}\n`
}

async function writeRootChangelog(entry, version) {
  const existing = existsSync(changelogPath) ? await readFile(changelogPath, 'utf8') : defaultRootChangelog()
  const withoutTrailingWhitespace = existing.trimEnd()
  const currentSection = sectionRange(withoutTrailingWhitespace, version)

  if (currentSection) {
    const updated = `${withoutTrailingWhitespace.slice(0, currentSection.start)}${entry.trimEnd()}${withoutTrailingWhitespace.slice(
      currentSection.end,
    )}\n`
    await writeFile(changelogPath, updated)
    return
  }

  const firstReleaseHeading = withoutTrailingWhitespace.search(/^##\s+/m)
  if (firstReleaseHeading === -1) {
    await writeFile(changelogPath, `${withoutTrailingWhitespace}\n\n${entry}`)
    return
  }

  await writeFile(
    changelogPath,
    `${withoutTrailingWhitespace.slice(0, firstReleaseHeading).trimEnd()}\n\n${entry}\n${withoutTrailingWhitespace
      .slice(firstReleaseHeading)
      .trimStart()}\n`,
  )
}

function sectionRange(content, version) {
  const start = content.search(new RegExp(`^##\\s+${escapeRegExp(version)}\\s*$`, 'm'))
  if (start === -1) return undefined

  const rest = content.slice(start + 1)
  const next = rest.search(/^##\s+/m)
  return {
    start,
    end: next === -1 ? content.length : start + 1 + next,
  }
}

function defaultRootChangelog() {
  return `# Changelog

Human-friendly release notes for synchronized Crux releases. Package-specific changelogs live next to each package.
`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
