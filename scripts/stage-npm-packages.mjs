#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localScope = '@use-crux'
const publishScope = '@use-crux'

/**
 * List of TypeScript packages that participate in the npm release staging pipeline.
 *
 * All publishable library source now lives under `src/` (standardized layout).
 * `sourceRoot` tells the stager:
 * - where to find sources for release path mappings and tsc emission prefix
 * - how to rewrite export targets from dev manifests ("./src/foo.ts" → "./dist/foo.js")
 *
 * During the phased src/ migration, a package may temporarily be inconsistent with its
 * declared sourceRoot; the build/check logic below tolerates this (see mixed-state notes).
 *
 * Postgres is included even though it was absent from some historical snapshots, because:
 * - it is a published package with its own exports (./runtime)
 * - Phase 2 of the layout workplan migrates it
 * - stager must emit its dist/ for full release staging to be correct
 */
const tsPackages = [
  { name: '@use-crux/core', dir: 'packages/core', sourceRoot: 'src' },
  { name: '@use-crux/ai', dir: 'packages/ai', sourceRoot: 'src' },
  { name: '@use-crux/anthropic', dir: 'packages/anthropic', sourceRoot: 'src' },
  { name: '@use-crux/convex', dir: 'packages/convex', sourceRoot: 'src' },
  { name: '@use-crux/google', dir: 'packages/google', sourceRoot: 'src' },
  { name: '@use-crux/indexer', dir: 'packages/indexer', sourceRoot: 'src' },
  { name: '@use-crux/ingest', dir: 'packages/ingest', sourceRoot: 'src' },
  { name: '@use-crux/next', dir: 'packages/next', sourceRoot: 'src' },
  { name: '@use-crux/openai', dir: 'packages/openai', sourceRoot: 'src' },
  { name: '@use-crux/otel', dir: 'packages/otel', sourceRoot: 'src' },
  { name: '@use-crux/postgres', dir: 'packages/postgres', sourceRoot: 'src' },
  { name: '@use-crux/react', dir: 'packages/react', sourceRoot: 'src' },
  { name: '@use-crux/upstash', dir: 'packages/upstash', sourceRoot: 'src' },
]

const localPlatforms = [
  { id: 'linux-x64', os: 'linux', cpu: 'x64', crux: 'crux', worker: 'crux-static-index-worker' },
  { id: 'linux-arm64', os: 'linux', cpu: 'arm64', crux: 'crux', worker: 'crux-static-index-worker' },
  { id: 'darwin-x64', os: 'darwin', cpu: 'x64', crux: 'crux', worker: 'crux-static-index-worker' },
  { id: 'darwin-arm64', os: 'darwin', cpu: 'arm64', crux: 'crux', worker: 'crux-static-index-worker' },
  { id: 'win32-x64', os: 'win32', cpu: 'x64', crux: 'crux.exe', worker: 'crux-static-index-worker.exe' },
  { id: 'win32-arm64', os: 'win32', cpu: 'arm64', crux: 'crux.exe', worker: 'crux-static-index-worker.exe' },
]

const options = parseArgs(process.argv.slice(2))
const stageRoot = resolve(repoRoot, options.out)
const buildRoot = resolve(repoRoot, '.tmp/npm-build/ts')
const releaseTsconfig = resolve(repoRoot, '.tmp/npm-build/tsconfig.release.json')

await rm(stageRoot, { recursive: true, force: true })
await mkdir(stageRoot, { recursive: true })

const versionByPackage = await readWorkspaceVersions()
if (options.version) {
  for (const name of versionByPackage.keys()) versionByPackage.set(name, options.version)
}
const stagedPackages = []

if (!options.skipTs) {
  await buildTypeScriptPackages()
  for (const pkg of tsPackages) {
    stagedPackages.push(await stageTypeScriptPackage(pkg))
  }
}

if (!options.skipLocal) {
  stagedPackages.push(await stageLocalWrapper())
  for (const platform of localPlatforms) {
    const staged = await stageLocalPlatform(platform)
    if (staged) stagedPackages.push(staged)
  }
}

await writeJson(join(stageRoot, 'packages.json'), {
  generatedAt: new Date().toISOString(),
  packages: stagedPackages,
})

console.log(`Staged ${stagedPackages.length} npm package(s) in ${relative(repoRoot, stageRoot)}`)

function parseArgs(args) {
  const parsed = {
    out: '.tmp/npm-stage',
    skipTs: false,
    skipLocal: false,
    allowMissingPlatforms: false,
    version: undefined,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--out') {
      parsed.out = args[++index]
    } else if (arg === '--skip-ts') {
      parsed.skipTs = true
    } else if (arg === '--skip-local') {
      parsed.skipLocal = true
    } else if (arg === '--allow-missing-platforms') {
      parsed.allowMissingPlatforms = true
    } else if (arg === '--version') {
      parsed.version = args[++index]
    } else if (arg === '--') {
      continue
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/stage-npm-packages.mjs [options]

Options:
  --out <dir>                  Stage packages into this directory. Default: .tmp/npm-stage
  --skip-ts                    Do not stage TypeScript library packages.
  --skip-local                 Do not stage Crux Local and platform binary packages.
  --allow-missing-platforms    Stage available platform binary packages instead of failing.
  --version <version>          Override every staged package version.
`)
  process.exit(0)
}

async function buildTypeScriptPackages() {
  await rm(buildRoot, { recursive: true, force: true })
  await mkdir(dirname(releaseTsconfig), { recursive: true })
  await writeJson(releaseTsconfig, await createReleaseTsconfig())

  run('pnpm', ['exec', 'tsc', '-p', releaseTsconfig], { cwd: repoRoot })

  for (const pkg of tsPackages) {
    const packageOut = packageBuildOutput(pkg)
    // After src/ unification, every pkg emits under its sourceRoot prefix (packageOut).
    // We assert the prefix dir exists (tsc processed the package's mapped sources).
    // Do not hard-require "index.js" at the prefix root: some pkgs (postgres) legitimately
    // have only subpath entries (main: "./src/runtime.ts" → no top-level index.js).
    // Fallback to historical root dir is kept for safety during any transition.
    // The authoritative contract is the per-export rewrite + what ends up in dist/.
    if (!existsSync(packageOut)) {
      const fallbackOut = join(buildRoot, pkg.dir)
      if (!existsSync(fallbackOut)) {
        throw new Error(`TypeScript build did not produce output under ${relative(repoRoot, packageOut)} (or fallback)`)
      }
    }
  }
}

async function createReleaseTsconfig() {
  const paths = {}
  for (const pkg of tsPackages) {
    const sourcePrefix = pkg.sourceRoot === '.' ? pkg.dir : `${pkg.dir}/${pkg.sourceRoot}`
    const manifest = await readJson(join(repoRoot, pkg.dir, 'package.json'))
    Object.assign(paths, releasePathMappings(pkg, manifest))
    if (!paths[pkg.name]) paths[pkg.name] = [`${sourcePrefix}/index.ts`, `${sourcePrefix}/index.tsx`]
    paths[`${pkg.name}/*`] = [`${sourcePrefix}/*`, `${pkg.dir}/*`]
  }

  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      strict: true,
      noEmit: false,
      declaration: true,
      declarationMap: false,
      sourceMap: false,
      outDir: relative(dirname(releaseTsconfig), buildRoot).replaceAll(sep, '/'),
      rootDir: relative(dirname(releaseTsconfig), repoRoot).replaceAll(sep, '/'),
      baseUrl: relative(dirname(releaseTsconfig), repoRoot).replaceAll(sep, '/'),
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      isolatedModules: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      types: ['node'],
      paths,
    },
    files: (await collectReleaseSourceFiles()).map((file) =>
      relative(dirname(releaseTsconfig), file).replaceAll(sep, '/'),
    ),
  }
}

function releasePathMappings(pkg, manifest) {
  const mappings = {}
  if (!manifest.exports || typeof manifest.exports !== 'object' || Array.isArray(manifest.exports)) {
    return mappings
  }

  for (const [key, value] of Object.entries(manifest.exports)) {
    if (!key.startsWith('.') || key === './package.json' || key.includes('*')) continue
    const target = sourceExportTarget(value)
    if (!target) continue

    const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`
    mappings[specifier] = [normalizeReleaseExportTarget(pkg, target)]
  }

  return mappings
}

function sourceExportTarget(target) {
  if (typeof target === 'string') return target
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined

  for (const condition of ['types', 'import', 'default']) {
    const resolved = sourceExportTarget(target[condition])
    if (resolved) return resolved
  }

  for (const value of Object.values(target)) {
    const resolved = sourceExportTarget(value)
    if (resolved) return resolved
  }
  return undefined
}

function normalizeReleaseExportTarget(pkg, target) {
  return `${pkg.dir}/${target.replace(/^\.\//, '')}`.replaceAll(sep, '/')
}

async function collectReleaseSourceFiles() {
  const packageRoots = tsPackages.map((pkg) => join(repoRoot, pkg.dir))
  const files = []
  for (const root of packageRoots) {
    files.push(...(await listFiles(root)))
  }
  return files
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .filter((file) => {
      const normalized = relative(repoRoot, file).replaceAll(sep, '/')
      if (normalized.includes('/__tests__/') || normalized.includes('/__type_tests__/')) return false
      if (normalized.includes('/.turbo/') || normalized.includes('/dist/')) return false
      if (normalized.includes('/scripts/')) return false
      if (normalized.endsWith('.test.ts') || normalized.endsWith('.test.tsx')) return false
      if (normalized.endsWith('/vitest.config.ts')) return false
      return true
    })
    .sort()
}

async function stageTypeScriptPackage(pkg) {
  const sourceDir = join(repoRoot, pkg.dir)
  const stageDir = packageStageDir(toPublishedPackageName(pkg.name))
  const distDir = join(stageDir, 'dist')
  const packageOut = packageBuildOutput(pkg)
  const sourceManifest = await readJson(join(sourceDir, 'package.json'))

  await mkdir(stageDir, { recursive: true })
  await cp(packageOut, distDir, { recursive: true })
  await createDirectoryIndexBridges(distDir)
  await rewriteRelativeJsSpecifiers(distDir)
  await copyIfExists(join(sourceDir, 'README.md'), join(stageDir, 'README.md'))
  await copyIfExists(join(sourceDir, 'LICENSE'), join(stageDir, 'LICENSE'))
  await rewriteTextFileIfExists(join(stageDir, 'README.md'), rewritePublishedScopeText)

  const manifest = transformTypeScriptManifest(sourceManifest, pkg)
  await writeJson(join(stageDir, 'package.json'), manifest)

  return stagedPackageRecord(manifest, stageDir)
}

function packageBuildOutput(pkg) {
  const sourcePrefix = pkg.sourceRoot === '.' ? pkg.dir : `${pkg.dir}/${pkg.sourceRoot}`
  return join(buildRoot, sourcePrefix)
}

function transformTypeScriptManifest(sourceManifest, pkg) {
  const manifest = pickPackageManifestFields(sourceManifest)
  manifest.name = toPublishedPackageName(sourceManifest.name)
  manifest.version = packageVersion(sourceManifest.name)
  manifest.private = undefined
  manifest.type = sourceManifest.type ?? 'module'
  // Derive root main/types from the dev manifest when present (supports pkgs without "."
  // entry like postgres whose main is "./src/runtime.ts"). rewriteExportPath performs
  // the sourceRoot strip + .ts→.js/.d.ts already used for exports.
  if (sourceManifest.main) {
    manifest.main = rewriteExportPath(sourceManifest.main, pkg, 'import')
  } else {
    manifest.main = './dist/index.js'
  }
  if (sourceManifest.types) {
    manifest.types = rewriteExportPath(sourceManifest.types, pkg, 'types')
  } else if (sourceManifest.main) {
    // derive sibling .d.ts target from main if types not separately declared
    const typesGuess = sourceManifest.main.replace(/\.ts$/, '.d.ts').replace(/\.tsx$/, '.d.ts')
    manifest.types = rewriteExportPath(typesGuess, pkg, 'types')
  } else {
    manifest.types = './dist/index.d.ts'
  }
  manifest.exports = transformExports(sourceManifest.exports, pkg)
  manifest.files = ['dist', 'README.md', 'LICENSE']
  manifest.publishConfig = { ...(sourceManifest.publishConfig ?? {}), access: 'public' }
  manifest.repository = repositoryFor(pkg.dir)
  manifest.dependencies = rewriteWorkspaceDependencyMap(sourceManifest.dependencies)
  manifest.peerDependencies = rewriteWorkspaceDependencyMap(sourceManifest.peerDependencies)
  manifest.peerDependenciesMeta = rewriteInternalDependencyKeyMap(sourceManifest.peerDependenciesMeta)
  manifest.optionalDependencies = rewriteWorkspaceDependencyMap(sourceManifest.optionalDependencies)

  delete manifest.private
  return removeEmptyManifestFields(manifest)
}

function transformExports(exportsField, pkg) {
  const exports = exportsField
    ? Object.fromEntries(Object.entries(exportsField).map(([key, value]) => [key, transformExportTarget(value, pkg)]))
    : {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
      }

  exports['./package.json'] = './package.json'
  return exports
}

function transformExportTarget(target, pkg) {
  if (typeof target === 'string') return rewriteExportPath(target, pkg, 'import')
  if (!target || typeof target !== 'object' || Array.isArray(target)) return target

  const transformed = {}
  for (const [condition, value] of Object.entries(target)) {
    if (condition === 'require') continue
    transformed[condition] = transformExportCondition(condition, value, pkg)
  }
  return transformed
}

function transformExportCondition(condition, value, pkg) {
  if (typeof value === 'string') return rewriteExportPath(value, pkg, condition)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([nestedCondition, nestedValue]) => [
      nestedCondition,
      transformExportCondition(nestedCondition, nestedValue, pkg),
    ]),
  )
}

function rewriteExportPath(target, pkg, condition) {
  if (target === './package.json') return target

  let normalized = target.replace(/^\.\//, '')
  if (pkg.sourceRoot !== '.' && normalized.startsWith(`${pkg.sourceRoot}/`)) {
    normalized = normalized.slice(pkg.sourceRoot.length + 1)
  }

  normalized = normalized.replace(/\.tsx?$/, condition === 'types' ? '.d.ts' : '.js')
  return `./dist/${normalized}`
}

async function stageLocalWrapper() {
  const sourceDir = join(repoRoot, 'packages/local/npm/local')
  const stageDir = packageStageDir(toPublishedPackageName('@use-crux/local'))
  await mkdir(stageDir, { recursive: true })
  await cp(sourceDir, stageDir, { recursive: true })

  const manifest = await readJson(join(stageDir, 'package.json'))
  manifest.name = toPublishedPackageName(manifest.name)
  manifest.version = packageVersion('@use-crux/local')
  manifest.optionalDependencies = Object.fromEntries(
    localPlatforms.map((platform) => [toPublishedPackageName(`@use-crux/local-${platform.id}`), manifest.version]),
  )
  manifest.files = ['bin', 'README.md', 'LICENSE']
  manifest.repository = repositoryFor('packages/local/npm/local')
  await writeJson(join(stageDir, 'package.json'), removeEmptyManifestFields(manifest))
  await rewriteTextFileIfExists(join(stageDir, 'README.md'), rewritePublishedScopeText)
  await rewriteTextFileIfExists(join(stageDir, 'bin/crux.cjs'), rewritePublishedScopeText)

  return stagedPackageRecord(manifest, stageDir)
}

async function stageLocalPlatform(platform) {
  const sourceBinDir = join(repoRoot, 'packages/local/dist', `crux-${platform.id}`, 'bin')
  const missing = [platform.crux, platform.worker].filter((name) => !existsSync(join(sourceBinDir, name)))
  if (missing.length > 0) {
    const message = `Missing ${platform.id} binary artifact(s): ${missing.join(', ')} in ${relative(repoRoot, sourceBinDir)}`
    if (options.allowMissingPlatforms) {
      console.warn(`Skipping ${toPublishedPackageName(`@use-crux/local-${platform.id}`)}: ${message}`)
      return undefined
    }
    throw new Error(
      `${message}\nRun make -C packages/local ${platform.id} after make -C packages/local build-devtools embed, or pass --allow-missing-platforms for a partial local staging run.`,
    )
  }

  const packageName = toPublishedPackageName(`@use-crux/local-${platform.id}`)
  const stageDir = packageStageDir(packageName)
  await mkdir(join(stageDir, 'bin'), { recursive: true })
  await cp(sourceBinDir, join(stageDir, 'bin'), { recursive: true })
  await copyIfExists(join(repoRoot, 'packages/local/npm/local/LICENSE'), join(stageDir, 'LICENSE'))
  await copyIfExists(join(repoRoot, 'packages/local/npm/local/README.md'), join(stageDir, 'README.md'))

  const localVersion = packageVersion('@use-crux/local')
  const manifest = {
    name: packageName,
    version: localVersion,
    description: `Crux local runtime binary for ${platform.id}`,
    os: [platform.os],
    cpu: [platform.cpu],
    files: ['bin', 'README.md', 'LICENSE'],
    license: 'Apache-2.0',
    publishConfig: { access: 'public' },
    repository: repositoryFor('packages/local'),
  }

  await writeJson(join(stageDir, 'package.json'), manifest)
  return stagedPackageRecord(manifest, stageDir)
}

function pickPackageManifestFields(sourceManifest) {
  const keys = [
    'name',
    'version',
    'description',
    'keywords',
    'author',
    'license',
    'homepage',
    'bugs',
    'funding',
    'engines',
    'type',
    'dependencies',
    'peerDependencies',
    'peerDependenciesMeta',
    'optionalDependencies',
    'publishConfig',
  ]
  return Object.fromEntries(
    keys.filter((key) => sourceManifest[key] !== undefined).map((key) => [key, sourceManifest[key]]),
  )
}

function rewriteWorkspaceDependencyMap(dependencies) {
  if (!dependencies) return undefined
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => [
      toPublishedPackageName(name),
      rewriteWorkspaceRange(name, range),
    ]),
  )
}

function rewriteInternalDependencyKeyMap(value) {
  if (!value) return undefined
  return Object.fromEntries(Object.entries(value).map(([name, config]) => [toPublishedPackageName(name), config]))
}

function rewriteWorkspaceRange(name, range) {
  if (typeof range !== 'string' || !range.startsWith('workspace:')) return range
  const version = versionByPackage.get(name)
  if (!version) throw new Error(`Cannot rewrite ${name}@${range}; package version not found in workspace.`)
  if (options.version) return version
  const spec = range.slice('workspace:'.length)
  if (spec === '' || spec === '*') return version
  if (spec === '^' || spec === '~') return `${spec}${version}`
  if (spec.startsWith('^') || spec.startsWith('~')) return spec
  return version
}

function packageVersion(name) {
  const version = versionByPackage.get(name)
  if (!version) throw new Error(`Cannot resolve staged version for ${name}.`)
  return version
}

async function createDirectoryIndexBridges(distDir) {
  const files = await listFiles(distDir)
  for (const file of files) {
    if (!file.endsWith(`${sep}index.js`) && file !== join(distDir, 'index.js')) continue
    const dir = dirname(file)
    if (dir === distDir) continue
    const bridgeBase = join(dirname(dir), `${dir.split(sep).at(-1)}`)
    const jsBridge = `${bridgeBase}.js`
    const dtsBridge = `${bridgeBase}.d.ts`
    const relativeIndex = `./${relative(dirname(jsBridge), file).replaceAll(sep, '/')}`

    if (!existsSync(jsBridge)) {
      await writeFile(jsBridge, `export * from ${JSON.stringify(ensureJsExtension(relativeIndex))};\n`)
    }
    if (!existsSync(dtsBridge)) {
      await writeFile(dtsBridge, `export * from ${JSON.stringify(relativeIndex.replace(/\.js$/, ''))};\n`)
    }
  }
}

async function rewriteRelativeJsSpecifiers(distDir) {
  const files = (await listFiles(distDir)).filter((file) => file.endsWith('.js'))
  for (const file of files) {
    const original = await readFile(file, 'utf8')
    const rewritten = original.replace(
      /((?:from|import)\s*(?:\(\s*)?['"])(\.[^'"]+)(['"]\s*\)?)/g,
      (match, prefix, specifier, suffix) => `${prefix}${resolveJsSpecifier(file, specifier)}${suffix}`,
    )
    if (rewritten !== original) await writeFile(file, rewritten)
  }
}

function rewritePublishedScopeText(text) {
  return text.replaceAll('@use-crux/', `${publishScope}/`)
}

function resolveJsSpecifier(fromFile, specifier) {
  if (extname(specifier)) return specifier
  const absolute = resolve(dirname(fromFile), specifier)
  if (existsSync(`${absolute}.js`)) return `${specifier}.js`
  if (existsSync(join(absolute, 'index.js'))) return `${specifier}/index.js`
  return specifier
}

function ensureJsExtension(specifier) {
  return specifier.endsWith('.js') ? specifier : `${specifier}.js`
}

async function readWorkspaceVersions() {
  const versions = new Map()
  for (const pkg of tsPackages) {
    const manifest = await readJson(join(repoRoot, pkg.dir, 'package.json'))
    versions.set(manifest.name, manifest.version)
  }
  const localManifest = await readJson(join(repoRoot, 'packages/local/npm/local/package.json'))
  versions.set(localManifest.name, localManifest.version)
  return versions
}

function repositoryFor(directory) {
  return {
    type: 'git',
    url: 'https://github.com/use-crux/crux.git',
    directory,
  }
}

function packageStageDir(name) {
  return join(stageRoot, ...name.split('/'))
}

function toPublishedPackageName(name) {
  if (typeof name !== 'string' || !name.startsWith(`${localScope}/`)) return name
  return `${publishScope}/${name.slice(localScope.length + 1)}`
}

function stagedPackageRecord(manifest, stageDir) {
  return {
    name: manifest.name,
    version: manifest.version,
    path: relative(stageRoot, stageDir).replaceAll(sep, '/'),
  }
}

async function copyIfExists(source, destination) {
  if (existsSync(source)) await cp(source, destination, { recursive: true })
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function rewriteTextFileIfExists(path, rewrite) {
  if (!existsSync(path)) return
  const original = await readFile(path, 'utf8')
  const rewritten = rewrite(original)
  if (rewritten !== original) await writeFile(path, rewritten)
}

function removeEmptyManifestFields(manifest) {
  return Object.fromEntries(
    Object.entries(manifest).filter(([, value]) => {
      if (value === undefined) return false
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false
      return true
    }),
  )
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}
