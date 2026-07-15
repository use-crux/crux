import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const RUNTIME_CLASSES = new Set(['portable-web', 'convex-server', 'next-server', 'node-only', 'compiler-local'])

/** Load and validate the source or staged package view used by portability checks. */
export async function loadPortabilityContext(repoRoot, options = {}) {
  const matrix = await readJson(join(repoRoot, 'scripts/portable-entrypoints.json'))
  if (matrix.version !== 1) {
    throw new Error(`Unsupported portability matrix version ${matrix.version}.`)
  }

  const stageRoot = options.stageRoot ? resolve(repoRoot, options.stageRoot) : undefined
  const stagedPackages = stageRoot ? await readStagedPackagePaths(stageRoot) : undefined
  const packages = new Map()

  for (const declaration of matrix.packages) {
    validateDeclaration(declaration)
    const sourceRoot = dirname(join(repoRoot, declaration.manifest))
    const root = stageRoot ? stagedPackages.get(declaration.name) : sourceRoot
    if (!root) {
      if (declaration.stage === 'local') continue
      throw new Error(`Expected staged package ${declaration.name} is missing from packages.json.`)
    }
    const manifest = await readJson(join(root, 'package.json'))
    const sourceManifest = stageRoot ? await readJson(join(sourceRoot, 'package.json')) : manifest
    validateEntrypointCoverage(declaration, manifest)
    packages.set(declaration.name, {
      declaration,
      manifest,
      root,
      sourceManifest,
      sourceRoot,
    })
  }

  return {
    matrix,
    mode: stageRoot ? 'staged' : 'source',
    packages,
    repoRoot,
    resolveEntrypoint(packageName, key, runtime) {
      const state = packages.get(packageName)
      if (!state) return undefined
      const target = entrypointTarget(state.manifest, key, runtime)
      if (!target) {
        throw new Error(`${packageName} has no runtime-resolvable ${key} entrypoint for ${runtime}.`)
      }
      const path = resolve(state.root, target)
      if (!existsSync(path)) {
        throw new Error(`${packageName} ${key} points at missing ${path}.`)
      }
      return path
    },
    resolveWorkspaceSpecifier(specifier, runtime) {
      const packageName = [...packages.keys()]
        .sort((left, right) => right.length - left.length)
        .find((candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`))
      if (!packageName) return undefined
      const key = specifier === packageName ? '.' : `./${specifier.slice(packageName.length + 1)}`
      return this.resolveEntrypoint(packageName, key, runtime)
    },
    resolveInstalledDependency(specifier, importer) {
      if (!stageRoot || !importer) return undefined
      const owner = this.ownerForInput(importer)
      if (!owner) return undefined
      const state = packages.get(owner.name)
      if (!state) return undefined
      const dependency = packageName(specifier)
      const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
        (field) => state.sourceManifest[field]?.[dependency] !== undefined,
      )
      if (!declared) {
        return { error: `${owner.name} staged output imports undeclared dependency ${dependency}.` }
      }
      return { resolveDir: state.sourceRoot }
    },
    ownerForInput(input) {
      const absolute = resolve(repoRoot, input)
      for (const [name, state] of packages) {
        const path = relative(state.root, absolute)
        if (path !== '..' && !path.startsWith(`..${sep}`)) {
          return { name, importer: path.replaceAll(sep, '/') }
        }
      }
      return undefined
    },
  }
}

function packageName(specifier) {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

/** Convert one matrix export key into its public package specifier. */
export function publicSpecifier(packageName, key) {
  if (key === '.') return packageName
  if (key.startsWith('./')) return `${packageName}/${key.slice(2)}`
  return `${packageName}#${key}`
}

function validateDeclaration(declaration) {
  if (declaration.stage !== undefined && declaration.stage !== 'local') {
    throw new Error(`${declaration.name} has unknown staging class ${declaration.stage}.`)
  }
  for (const [key, runtime] of Object.entries(declaration.entrypoints)) {
    if (!RUNTIME_CLASSES.has(runtime)) {
      throw new Error(`${declaration.name} ${key} has unknown runtime class ${runtime}.`)
    }
  }
}

function validateEntrypointCoverage(declaration, manifest) {
  const actual = Object.keys(manifest.exports ?? {}).filter((key) => key !== './package.json')
  if (manifest.bin) {
    actual.push(...Object.keys(manifest.bin).map((name) => `bin:${name}`))
  }
  const expected = Object.keys(declaration.entrypoints)
  const missing = actual.filter((key) => !expected.includes(key))
  const stale = expected.filter((key) => !actual.includes(key))
  if (missing.length || stale.length) {
    throw new Error(
      `${declaration.name} matrix mismatch: missing [${missing.join(', ')}], stale [${stale.join(', ')}].`,
    )
  }
}

function entrypointTarget(manifest, key, runtime) {
  if (key.startsWith('bin:')) return manifest.bin?.[key.slice(4)]
  return resolveRuntimeExportTarget(manifest.exports?.[key], runtime)
}

/** Resolve an export map using only the conditions active for one runtime class. */
export function resolveRuntimeExportTarget(value, runtime) {
  return exportTarget(value, new Set([...conditionsFor(runtime), 'import', 'default']))
}

function exportTarget(value, conditions) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  for (const [condition, nested] of Object.entries(value)) {
    if (!conditions.has(condition)) continue
    const target = exportTarget(nested, conditions)
    if (target) return target
  }
  return undefined
}

function conditionsFor(runtime) {
  if (runtime === 'convex-server') return ['worker', 'browser']
  if (runtime === 'next-server') return ['edge-light', 'worker']
  if (runtime === 'portable-web') return ['worker', 'browser']
  return ['node']
}

async function readStagedPackagePaths(stageRoot) {
  const index = await readJson(join(stageRoot, 'packages.json'))
  return new Map(index.packages.map((entry) => [entry.name, join(stageRoot, entry.path)]))
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
