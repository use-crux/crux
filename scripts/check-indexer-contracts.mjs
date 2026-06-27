#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = 'packages/indexer/contracts/contract-manifest.json'
const baselinePath = 'packages/indexer/docs/static-index-runtime-architecture-baseline.md'
const expectedGroupIds = ['worker-events', 'static-syntax-records', 'static-index', 'semantic-evidence']
const mirrorStatuses = new Set(['generated', 'checked-mirror', 'typescript-only'])
const runtimes = new Set(['typescript', 'go', 'rust'])

/** @typedef {{ version: string, runtime: string, path: string, pattern: string }} VersionCheck */
/** @typedef {{ go: string[], rust: string[] }} MirrorPaths */
/** @typedef {{ id: string, label: string, description: string, mirrorStatus: string, canonical: string[], fixtures: string[], mirrors: MirrorPaths, fixtureCoverage: string, jsonBoundaries: string[] }} ContractGroup */
/** @typedef {{ schemaVersion: number, protocolVersions: Record<string, number>, protocolVersionChecks: VersionCheck[], groups: ContractGroup[] }} ContractManifest */

const errors = []
const manifest = await readManifest()
const baseline = await readRepoFile(baselinePath)

validateManifestShape(manifest)
await validateVersionChecks(manifest)
await validateGroups(manifest, baseline)

if (errors.length > 0) {
  console.error(`Indexer contract check failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(
    `Indexer contract check passed: ${manifest.groups.length} groups, ${manifest.protocolVersionChecks.length} version checks.`,
  )
}

/**
 * Read the canonical manifest JSON.
 *
 * @returns {Promise<ContractManifest>}
 */
async function readManifest() {
  return JSON.parse(await readRepoFile(manifestPath))
}

/**
 * Validate high-level manifest fields before deeper file checks.
 *
 * @param {ContractManifest} manifest
 */
function validateManifestShape(manifest) {
  if (manifest.schemaVersion !== 1) {
    errors.push(`manifest schemaVersion must be 1, got ${manifest.schemaVersion}`)
  }
  const groupIds = manifest.groups.map((group) => group.id)
  if (JSON.stringify(groupIds) !== JSON.stringify(expectedGroupIds)) {
    errors.push(`manifest group order must be ${expectedGroupIds.join(', ')}, got ${groupIds.join(', ')}`)
  }
  for (const [name, version] of Object.entries(manifest.protocolVersions)) {
    if (!Number.isInteger(version) || version <= 0) {
      errors.push(`protocol version ${name} must be a positive integer`)
    }
  }
}

/**
 * Ensure every declared protocol version is mirrored by TypeScript, Go, and Rust.
 *
 * @param {ContractManifest} manifest
 */
async function validateVersionChecks(manifest) {
  const coverage = new Set()
  for (const check of manifest.protocolVersionChecks) {
    if (!runtimes.has(check.runtime)) {
      errors.push(`${check.version}: unknown runtime ${check.runtime}`)
      continue
    }
    const expected = manifest.protocolVersions[check.version]
    if (expected === undefined) {
      errors.push(`${check.version}: version check references an unknown protocol version`)
      continue
    }
    const source = await readRepoFile(check.path)
    const match = new RegExp(check.pattern).exec(source)
    if (!match) {
      errors.push(`${check.version}: ${check.path} did not match ${check.pattern}`)
      continue
    }
    const actual = Number(match[1])
    if (actual !== expected) {
      errors.push(`${check.version}: ${check.runtime} mirror has ${actual}, expected ${expected}`)
    }
    coverage.add(`${check.version}:${check.runtime}`)
  }

  for (const version of Object.keys(manifest.protocolVersions)) {
    for (const runtime of runtimes) {
      if (!coverage.has(`${version}:${runtime}`)) {
        errors.push(`${version}: missing ${runtime} protocol version check`)
      }
    }
  }
}

/**
 * Validate contract group paths, fixture JSON, mirror status, and docs coverage.
 *
 * @param {ContractManifest} manifest
 * @param {string} baseline
 */
async function validateGroups(manifest, baseline) {
  for (const group of manifest.groups) {
    if (!mirrorStatuses.has(group.mirrorStatus)) {
      errors.push(`${group.id}: unknown mirror status ${group.mirrorStatus}`)
    }
    if (group.mirrorStatus === 'typescript-only' && (group.mirrors.go.length > 0 || group.mirrors.rust.length > 0)) {
      errors.push(`${group.id}: typescript-only groups must not declare Go or Rust mirrors`)
    }
    if (group.mirrorStatus !== 'typescript-only' && group.mirrors.go.length === 0 && group.mirrors.rust.length === 0) {
      errors.push(`${group.id}: mirrored groups must declare at least one Go or Rust mirror`)
    }
    if (group.canonical.length === 0) errors.push(`${group.id}: missing TypeScript canonical paths`)
    if (group.fixtures.length === 0) errors.push(`${group.id}: missing fixture paths`)
    if (group.jsonBoundaries.length === 0) errors.push(`${group.id}: missing JSON boundary classification`)

    for (const path of contractGroupPaths(group)) await assertPathExists(`${group.id}: path`, path)
    for (const path of group.fixtures) await assertJsonFixture(`${group.id}: fixture`, path)

    if (!baseline.includes(`\`${group.id}\``)) {
      errors.push(`${group.id}: architecture baseline does not mention the group id`)
    }
    if (!baseline.includes(group.fixtureCoverage)) {
      errors.push(`${group.id}: architecture baseline does not include fixture coverage text`)
    }
  }
}

/**
 * Return every repository path declared by a contract group.
 *
 * @param {ContractGroup} group
 * @returns {string[]}
 */
function contractGroupPaths(group) {
  return [...group.canonical, ...group.fixtures, ...group.mirrors.go, ...group.mirrors.rust]
}

/**
 * Read a repository-relative file as UTF-8 text.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
async function readRepoFile(path) {
  return readFile(join(repoRoot, path), 'utf8')
}

/**
 * Assert that a repository-relative path exists.
 *
 * @param {string} label
 * @param {string} path
 */
async function assertPathExists(label, path) {
  try {
    await access(join(repoRoot, path))
  } catch {
    errors.push(`${label} does not exist: ${path}`)
  }
}

/**
 * Assert that a listed fixture exists and parses as JSON.
 *
 * @param {string} label
 * @param {string} path
 */
async function assertJsonFixture(label, path) {
  try {
    JSON.parse(await readRepoFile(path))
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${path} (${error.message})`)
  }
}
