import { readFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { EdgeVM } from '@edge-runtime/vm'
import { build } from 'esbuild'
import { publicSpecifier, resolveRuntimeExportTarget } from './matrix.mjs'

const PORTABLE_CLASSES = new Set(['portable-web', 'convex-server', 'next-server'])
const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))

/** Check every portable export, guarded fallback, smoke, and negative fixture. */
export async function checkPortableEntrypoints(context) {
  const observedFallbacks = new Set()
  const nodeOnlyTargets = nodeOnlyEntrypoints(context)
  let checked = 0

  for (const [packageName, state] of context.packages) {
    validateNodeEngine(packageName, state)
    for (const [key, runtime] of Object.entries(state.declaration.entrypoints)) {
      if (!PORTABLE_CLASSES.has(runtime)) continue
      const entry = context.resolveEntrypoint(packageName, key, runtime)
      const result = await bundleEntry(context, entry, runtime, {
        externals: state.declaration.externals ?? [],
      })
      inspectNodeEdges(context, result, observedFallbacks)
      rejectEmittedStaticNodeImports(result, publicSpecifier(packageName, key))
      rejectNodeOnlyReachability(context, result, nodeOnlyTargets, packageName, key)
      checked += 1
    }
  }

  for (const fallback of context.matrix.guardedNodeFallbacks) {
    if (!context.packages.has(fallback.owner)) continue
    if (!observedFallbacks.has(fallbackKey(fallback))) {
      throw new Error(`Registered fallback was not observed: ${JSON.stringify(fallback)}.`)
    }
  }

  await runGuardedFallbackSmokes(context)
  if (context.mode === 'source') await runNegativeFixtures(context)
  return { checked }
}

async function bundleEntry(context, entry, runtime, options = {}) {
  const { externals = [], format = 'esm' } = options
  rejectNodeBuiltinExternals(externals)
  return build({
    absWorkingDir: context.repoRoot,
    bundle: true,
    conditions: conditionsFor(runtime),
    entryPoints: [entry],
    format,
    logLevel: 'silent',
    metafile: true,
    platform: 'browser',
    plugins: [workspaceResolver(context, externals, runtime)],
    write: false,
  })
}

function inspectNodeEdges(context, result, observed) {
  for (const [input, facts] of Object.entries(result.metafile.inputs)) {
    for (const edge of facts.imports) {
      if (!isNodeBuiltin(edge.path)) continue
      const owner = context.ownerForInput(input)
      const fallback = context.matrix.guardedNodeFallbacks.find(
        (candidate) =>
          owner?.name === candidate.owner &&
          owner.importer === (context.mode === 'source' ? candidate.sourceImporter : candidate.stagedImporter) &&
          edge.path === candidate.specifier &&
          edge.kind === candidate.kind,
      )
      if (!fallback) {
        throw new Error(
          `Unregistered Node edge ${owner?.name ?? 'unknown'}:${owner?.importer ?? input} -> ${edge.path} (${edge.kind}).`,
        )
      }
      observed.add(fallbackKey(fallback))
    }
  }
}

function rejectEmittedStaticNodeImports(result, specifier) {
  const staticNodeImport = /(?:^|\n)\s*(?:import\s+["']node:|import\s+[^;\n]+?\sfrom\s+["']node:)/m
  for (const output of result.outputFiles) {
    if (staticNodeImport.test(output.text)) {
      throw new Error(`${specifier} emitted a static node:* import.`)
    }
  }
}

function rejectNodeOnlyReachability(context, result, nodeOnlyTargets, packageName, key) {
  const inputs = new Set(Object.keys(result.metafile.inputs).map((input) => resolve(context.repoRoot, input)))
  for (const [nodeSpecifier, target] of nodeOnlyTargets) {
    if (inputs.has(resolve(target))) {
      throw new Error(`${publicSpecifier(packageName, key)} reaches Node-only ${nodeSpecifier}.`)
    }
  }
}

async function runGuardedFallbackSmokes(context) {
  const required = new Set(
    context.matrix.guardedNodeFallbacks
      .filter((fallback) => context.packages.has(fallback.owner))
      .map((fallback) => fallback.smoke),
  )
  for (const name of required) {
    const fixture = context.matrix.smokes[name]
    if (!fixture) throw new Error(`Missing portability smoke ${name}.`)
    const result = await bundleEntry(context, resolve(context.repoRoot, fixture), 'portable-web', {
      format: 'iife',
    })
    const observed = new Set()
    inspectNodeEdges(context, result, observed)
    for (const fallback of context.matrix.guardedNodeFallbacks.filter(
      (candidate) => candidate.smoke === name && context.packages.has(candidate.owner),
    )) {
      if (!observed.has(fallbackKey(fallback))) {
        throw new Error(`${name} did not exercise registered fallback ${JSON.stringify(fallback)}.`)
      }
    }
    await runInEdgeVm(result.outputFiles[0].text, name)
  }
}

async function runInEdgeVm(code, name) {
  const vm = new EdgeVM({
    initialCode: `
      globalThis.__cruxUnhandled = [];
      addEventListener('unhandledrejection', (event) => {
        globalThis.__cruxUnhandled.push(String(event.reason));
      });
    `,
  })
  vm.evaluate(code)
  await vm.evaluate('new Promise((resolve) => setTimeout(resolve, 0))')
  const status = vm.evaluate('({ marker: globalThis.__cruxPortabilitySmoke, unhandled: globalThis.__cruxUnhandled })')
  if (status.marker !== 'ok' || status.unhandled.length > 0) {
    throw new Error(`${name} edge smoke failed: ${JSON.stringify(status)}.`)
  }
}

async function runNegativeFixtures(context) {
  for (const [name, fixture, expected] of [
    ['static Node import', 'static-node-import.mjs', /Could not resolve "node:fs"/],
    [
      'unregistered guarded Node require',
      'unregistered-guarded-node.mjs',
      /Unregistered Node edge .*node:path \(require-call\)/,
    ],
    [
      'unregistered guarded Node dynamic import',
      'unregistered-guarded-dynamic-node.mjs',
      /Unregistered Node edge .*node:path \(dynamic-import\)/,
    ],
    ['Node-only re-export', 'node-only-reexport.ts', /reaches Node-only @use-crux\/core\/runtime\/testing/],
  ]) {
    const path = resolve(context.repoRoot, 'scripts/fixtures/portability', fixture)
    let rejection
    try {
      const result = await bundleEntry(context, path, 'portable-web')
      inspectNodeEdges(context, result, new Set())
      rejectNodeOnlyReachability(context, result, nodeOnlyEntrypoints(context), 'fixture', '.')
    } catch (error) {
      rejection = error
    }
    if (!rejection) throw new Error(`Negative fixture passed: ${name}.`)
    if (!expected.test(String(rejection))) {
      throw new Error(`Negative fixture ${name} failed for an unexpected reason: ${String(rejection)}`)
    }
  }

  for (const external of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'fs/*']) {
    await expectNegativeFailure(
      `declared Node built-in external ${external}`,
      () =>
        bundleEntry(
          context,
          resolve(context.repoRoot, 'scripts/fixtures/portability/static-node-import.mjs'),
          'portable-web',
          { externals: [external] },
        ),
      new RegExp(`must not externalize Node built-in ${escapeRegExp(external)}`),
    )
  }

  const conditionalTarget = resolveRuntimeExportTarget(
    {
      types: './conditional-portable.d.ts',
      worker: './conditional-worker-node.mjs',
      import: './conditional-portable.mjs',
    },
    'portable-web',
  )
  if (conditionalTarget !== './conditional-worker-node.mjs') {
    throw new Error(`Portable export conditions selected unexpected target ${conditionalTarget}.`)
  }
  if (resolveRuntimeExportTarget({ types: './type-only.d.ts' }, 'portable-web') !== undefined) {
    throw new Error('Portable export conditions selected a types-only target.')
  }
  await expectNegativeFailure(
    'conditional worker Node edge',
    async () => {
      const result = await bundleEntry(
        context,
        resolve(context.repoRoot, 'scripts/fixtures/portability', conditionalTarget),
        'portable-web',
      )
      inspectNodeEdges(context, result, new Set())
    },
    /Could not resolve "node:fs"/,
  )
}

function nodeOnlyEntrypoints(context) {
  return [...context.packages.values()].flatMap((state) =>
    Object.entries(state.declaration.entrypoints)
      .filter(([, runtime]) => runtime === 'node-only')
      .map(([key]) => [
        publicSpecifier(state.declaration.name, key),
        context.resolveEntrypoint(state.declaration.name, key, 'node-only'),
      ]),
  )
}

function validateNodeEngine(packageName, state) {
  const primary =
    state.declaration.entrypoints['.'] ??
    Object.entries(state.declaration.entrypoints).find(([key]) => key.startsWith('bin:'))?.[1]
  if (primary && PORTABLE_CLASSES.has(primary) && state.manifest.engines?.node) {
    throw new Error(`${packageName} has a portable primary entrypoint but still declares engines.node.`)
  }
  if (primary === 'compiler-local' && !state.manifest.engines?.node) {
    throw new Error(`${packageName} compiler/local package must declare engines.node.`)
  }
}

function workspaceResolver(context, externals, runtime) {
  return {
    name: 'crux-portability-workspaces',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@use-crux\// }, (args) => {
        if (isExternal(args.path, externals)) return { path: args.path, external: true }
        const path = context.resolveWorkspaceSpecifier(args.path, runtime)
        return path ? { path } : { errors: [{ text: `Unknown workspace import ${args.path}.` }] }
      })
      buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
        if (isNodeBuiltin(args.path)) return undefined
        if (isExternal(args.path, externals)) return { path: args.path, external: true }
        return undefined
      })
    },
  }
}

function rejectNodeBuiltinExternals(patterns) {
  for (const pattern of patterns) {
    if (isNodeBuiltin(pattern.replace(/\/\*$/, ''))) {
      throw new Error(`Portable bundles must not externalize Node built-in ${pattern}.`)
    }
  }
}

function isNodeBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true
  return [...NODE_BUILTINS].some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

async function expectNegativeFailure(name, action, expected) {
  let rejection
  try {
    await action()
  } catch (error) {
    rejection = error
  }
  if (!rejection) throw new Error(`Negative self-test passed: ${name}.`)
  if (!expected.test(String(rejection))) {
    throw new Error(`Negative self-test ${name} failed for an unexpected reason: ${String(rejection)}`)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isExternal(specifier, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith('/*') ? specifier.startsWith(pattern.slice(0, -1)) : specifier === pattern,
  )
}

function conditionsFor(runtime) {
  if (runtime === 'convex-server') return ['worker', 'browser', 'import']
  if (runtime === 'next-server') return ['edge-light', 'worker', 'import']
  return ['worker', 'browser', 'import']
}

function fallbackKey(fallback) {
  return [fallback.owner, fallback.sourceImporter, fallback.stagedImporter, fallback.specifier, fallback.kind].join(
    '\0',
  )
}
