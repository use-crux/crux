#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stageRoot = resolve(repoRoot, process.argv[2] ?? '.tmp/npm-stage')
const indexPath = join(stageRoot, 'packages.json')
const index = JSON.parse(await readFile(indexPath, 'utf8'))
const deprecatedScope = `${'@'}crux`

/**
 * Platform package contract for `@use-crux/local`.
 *
 * The wrapper package resolves one of these optional dependencies at runtime.
 * Each platform package must carry the Go CLI plus the sibling Rust Static
 * Index worker, because the Go runtime discovers that worker beside itself.
 */
const localPlatformPackages = new Map([
  [
    '@use-crux/local-linux-x64',
    { os: 'linux', cpu: 'x64', binaries: ['bin/crux', 'bin/crux-static-index-worker'] },
  ],
  [
    '@use-crux/local-linux-arm64',
    { os: 'linux', cpu: 'arm64', binaries: ['bin/crux', 'bin/crux-static-index-worker'] },
  ],
  [
    '@use-crux/local-darwin-x64',
    { os: 'darwin', cpu: 'x64', binaries: ['bin/crux', 'bin/crux-static-index-worker'] },
  ],
  [
    '@use-crux/local-darwin-arm64',
    { os: 'darwin', cpu: 'arm64', binaries: ['bin/crux', 'bin/crux-static-index-worker'] },
  ],
  [
    '@use-crux/local-win32-x64',
    { os: 'win32', cpu: 'x64', binaries: ['bin/crux.exe', 'bin/crux-static-index-worker.exe'] },
  ],
  [
    '@use-crux/local-win32-arm64',
    { os: 'win32', cpu: 'arm64', binaries: ['bin/crux.exe', 'bin/crux-static-index-worker.exe'] },
  ],
])

const failures = []

await validateCommittedWorkspaceManifests(failures)

for (const staged of index.packages) {
  const packageDir = join(stageRoot, staged.path)
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  if (manifest.private) failures.push(`${staged.name}: staged package.json must not be private`)
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const localScopeDeps = Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith(`${deprecatedScope}/`))
    if (localScopeDeps.length > 0) {
      failures.push(`${staged.name}: ${field} contains deprecated package names ${localScopeDeps.join(', ')}`)
    }
  }
  for (const target of exportTargets(manifest.exports)) {
    if (target.includes('*')) continue
    if (!target.startsWith('./')) continue
    if (!existsSync(join(packageDir, target))) {
      failures.push(`${staged.name}: package export points at missing file ${target}`)
    }
  }

  const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (pack.status !== 0) {
    failures.push(`${staged.name}: npm pack --dry-run failed\n${pack.stderr || pack.stdout}`)
    continue
  }

  const [result] = JSON.parse(pack.stdout)
  const paths = result.files.map((file) => file.path)
  const localPlatform = localPlatformPackages.get(staged.name)
  if (localPlatform) {
    if (!matchesSingleValueArray(manifest.os, localPlatform.os)) {
      failures.push(`${staged.name}: package.json must declare os ${JSON.stringify([localPlatform.os])}`)
    }
    if (!matchesSingleValueArray(manifest.cpu, localPlatform.cpu)) {
      failures.push(`${staged.name}: package.json must declare cpu ${JSON.stringify([localPlatform.cpu])}`)
    }
    for (const binary of localPlatform.binaries) {
      if (!paths.includes(binary)) {
        failures.push(`${staged.name}: tarball missing required binary ${binary}`)
      }
    }
  }

  for (const path of paths) {
    if (path.includes('__tests__/') || path.includes('__type_tests__/')) {
      failures.push(`${staged.name}: tarball includes test-only file ${path}`)
    }
    if ((path.endsWith('.ts') || path.endsWith('.tsx')) && !path.endsWith('.d.ts')) {
      failures.push(`${staged.name}: tarball includes raw TypeScript source ${path}`)
    }
    if (path === 'tsconfig.json' || path.endsWith('/tsconfig.json') || path.endsWith('vitest.config.ts')) {
      failures.push(`${staged.name}: tarball includes development config ${path}`)
    }
    if (path.endsWith('.js') || path.endsWith('.d.ts')) {
      const content = await readFile(join(packageDir, path), 'utf8')
      if (hasLocalScopePackageImport(content)) {
        failures.push(`${staged.name}: tarball includes deprecated package import in ${path}`)
      }
    }
  }

  if (staged.name === '@use-crux/local') {
    const optional = manifest.optionalDependencies ?? {}
    const missing = [
      '@use-crux/local-linux-x64',
      '@use-crux/local-linux-arm64',
      '@use-crux/local-darwin-x64',
      '@use-crux/local-darwin-arm64',
      '@use-crux/local-win32-x64',
      '@use-crux/local-win32-arm64',
    ].filter((name) => optional[name] !== manifest.version)
    if (missing.length > 0) {
      failures.push(
        `${staged.name}: optionalDependencies missing exact platform package versions for ${missing.join(', ')}`,
      )
    }
  }

  console.log(`${staged.name}@${staged.version}: ${result.entryCount} files, ${result.unpackedSize} bytes unpacked`)
}

if (failures.length > 0) {
  console.error('\nStaged package validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Validated ${index.packages.length} staged package(s).`)

function exportTargets(exportsField) {
  if (!exportsField) return []
  if (typeof exportsField === 'string') return [exportsField]
  if (Array.isArray(exportsField) || typeof exportsField !== 'object') return []

  const targets = []
  for (const [key, value] of Object.entries(exportsField)) {
    if (key.startsWith('.')) {
      targets.push(...exportTargets(value))
    } else if (key === 'types' || key === 'import' || key === 'default') {
      targets.push(...exportTargets(value))
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      targets.push(...exportTargets(value))
    }
  }
  return targets
}

function hasLocalScopePackageImport(content) {
  return (
    new RegExp(String.raw`(?:from|import)\s+['"]${deprecatedScope}/`).test(content) ||
    new RegExp(String.raw`import\s*\(\s*['"]${deprecatedScope}/`).test(content) ||
    new RegExp(String.raw`require\s*\(\s*['"]${deprecatedScope}/`).test(content)
  )
}

function matchesSingleValueArray(value, expected) {
  return Array.isArray(value) && value.length === 1 && value[0] === expected
}

async function validateCommittedWorkspaceManifests(failures) {
  const manifests = await committedPackageManifests(repoRoot)
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const platformOptionalDeps = Object.keys(manifest.optionalDependencies ?? {}).filter((name) =>
      localPlatformPackages.has(name),
    )
    if (platformOptionalDeps.length > 0) {
      failures.push(
        `${relativeToRepo(manifestPath)}: Platform optionalDependencies must be staged for @use-crux/local publish output only; remove ${platformOptionalDeps.join(', ')}`,
      )
    }
  }
}

async function committedPackageManifests(root) {
  const ignoredDirectories = new Set([
    '.git',
    '.tmp',
    '.turbo',
    'dist',
    'node_modules',
    'target',
    'tmp',
  ])
  const entries = await readdir(root, { withFileTypes: true })
  const manifests = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue
      manifests.push(...(await committedPackageManifests(join(root, entry.name))))
      continue
    }
    if (entry.isFile() && entry.name === 'package.json') {
      manifests.push(join(root, entry.name))
    }
  }
  return manifests
}

function relativeToRepo(file) {
  return file.startsWith(`${repoRoot}/`) ? file.slice(repoRoot.length + 1) : file
}
