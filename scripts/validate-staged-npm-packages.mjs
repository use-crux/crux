#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const stagedPackages = new Map()

await validateCommittedWorkspaceManifests(failures)

const stagedPackageNames = new Set(index.packages.map((staged) => staged.name))
if (stagedPackageNames.has('@use-crux/core')) {
  const portability = spawnSync('node', ['./scripts/check-portable-entrypoints.mjs', '--stage-root', stageRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (portability.status !== 0) {
    failures.push(`staged portability validation failed\n${portability.stderr || portability.stdout}`)
  } else if (portability.stdout) {
    process.stdout.write(portability.stdout)
  }
}

for (const staged of index.packages) {
  const packageDir = join(stageRoot, staged.path)
  stagedPackages.set(staged.name, packageDir)
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

  const packOutput = JSON.parse(pack.stdout)
  const result = Array.isArray(packOutput) ? packOutput[0] : packOutput[staged.name]
  if (!result) {
    failures.push(`${staged.name}: npm pack --dry-run returned an unexpected JSON result`)
    continue
  }
  const packedFiles = new Map(result.files.map((file) => [file.path, file]))
  const paths = [...packedFiles.keys()]
  const localPlatform = localPlatformPackages.get(staged.name)
  if (localPlatform) {
    if (!matchesSingleValueArray(manifest.os, localPlatform.os)) {
      failures.push(`${staged.name}: package.json must declare os ${JSON.stringify([localPlatform.os])}`)
    }
    if (!matchesSingleValueArray(manifest.cpu, localPlatform.cpu)) {
      failures.push(`${staged.name}: package.json must declare cpu ${JSON.stringify([localPlatform.cpu])}`)
    }
    for (const binary of localPlatform.binaries) {
      const packedBinary = packedFiles.get(binary)
      if (!packedBinary) {
        failures.push(`${staged.name}: tarball missing required binary ${binary}`)
      } else if (localPlatform.os !== 'win32' && (packedBinary.mode & 0o111) === 0) {
        failures.push(`${staged.name}: tarball binary ${binary} must be executable`)
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

if (failures.length === 0) {
  await validateLocalPackedInstall(stagedPackages, failures)
}

if (failures.length > 0) {
  console.error('\nStaged package validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Validated ${index.packages.length} staged package(s).`)

async function validateLocalPackedInstall(stagedPackages, failures) {
  const platformName = platformPackageName(process.platform, process.arch)
  const wrapperDir = stagedPackages.get('@use-crux/local')
  const platformDir = platformName ? stagedPackages.get(platformName) : undefined
  if (!wrapperDir || !platformDir) return

  const smokeRoot = await mkdtemp(join(tmpdir(), 'crux-local-packed-install-'))
  const packDir = join(smokeRoot, 'packs')
  const installDir = join(smokeRoot, 'install')

  try {
    await mkdir(packDir)
    await mkdir(installDir)
    const tarballs = []

    for (const [name, packageDir] of [
      ['@use-crux/local', wrapperDir],
      [platformName, platformDir],
    ]) {
      const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], {
        cwd: packageDir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 30_000,
      })
      if (pack.status !== 0) {
        failures.push(`${name}: npm pack failed during installed CLI smoke test\n${pack.stderr || pack.stdout}`)
        return
      }

      const result = packResult(pack.stdout, name)
      if (!result?.filename) {
        failures.push(`${name}: npm pack returned an unexpected result during installed CLI smoke test`)
        return
      }
      tarballs.push(join(packDir, result.filename))
    }

    const install = spawnSync(
      'npm',
      ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs],
      {
        cwd: installDir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 30_000,
      },
    )
    if (install.status !== 0) {
      failures.push(`@use-crux/local: packed install smoke test failed\n${install.stderr || install.stdout}`)
      return
    }

    const shim = join(installDir, 'node_modules', '.bin', process.platform === 'win32' ? 'crux.cmd' : 'crux')
    const help = spawnSync(shim, ['--help'], {
      cwd: installDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 30_000,
    })
    if (help.status !== 0) {
      failures.push(`@use-crux/local: installed crux --help failed\n${help.stderr || help.stdout}`)
      return
    }

    console.log(`@use-crux/local: installed ${platformName} tarballs and ran crux --help`)
  } finally {
    await rm(smokeRoot, { recursive: true, force: true })
  }
}

function platformPackageName(platform, arch) {
  const name = `@use-crux/local-${platform}-${arch}`
  return localPlatformPackages.has(name) ? name : undefined
}

function packResult(output, packageName) {
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed[0] : parsed[packageName]
}

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
