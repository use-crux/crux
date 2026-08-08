import { build } from 'esbuild'
import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const distDir = resolve(rootDir, 'dist')
const lockfile = await readFile(resolve(rootDir, '../..', 'pnpm-lock.yaml'), 'utf8')
const indexerPackage = JSON.parse(await readFile(resolve(rootDir, '../indexer/package.json'), 'utf8'))
if (typeof indexerPackage.version !== 'string' || indexerPackage.version.length === 0) {
  throw new Error('@use-crux/indexer package version is missing')
}

/** Shared esbuild options for self-contained Node.js bundles. */
const shared = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  // Bundle ALL dependencies into a single file so the output runs with
  // just `node`, no node_modules needed. Only Node.js builtins are external.
  packages: undefined,
  external: [
    // Node.js builtins — both prefixed and bare forms, since CJS deps
    // like `ws` use require("events") without the node: prefix.
    'node:*',
    ...builtinModules,
    // Optional peer deps with native addons — can't be bundled.
    '@ngrok/ngrok',
    'localtunnel',
  ],
  legalComments: 'none',
  // Provide a real `require` for CJS deps (like ws) that use require("events")
  // instead of import. Without this, esbuild's ESM shim can't resolve builtins.
  banner: {
    js: `import { createRequire as __crux_createRequire } from "node:module"; import { fileURLToPath as __crux_fileURLToPath } from "node:url"; import { dirname as __crux_dirname } from "node:path"; const require = __crux_createRequire(import.meta.url); const __filename = __crux_fileURLToPath(import.meta.url); const __dirname = __crux_dirname(__filename);`,
  },
}

try {
  // Recreate generated output so workers removed by a clean migration cannot
  // survive a rebuild as stale, accidentally packaged artifacts.
  await rm(distDir, { recursive: true, force: true })
  const [evalResult, resolverResult, indexerResult, semanticIndexerResult, runtimeIndexerResult, runtimeWorkerResult, anydocRunnerResult] = await Promise.all([
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/eval-coordinator.ts')],
      outfile: resolve(rootDir, 'dist/eval-coordinator.mjs'),
      external: [...shared.external, '@use-crux/core', '@use-crux/core/*'],
    }),
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/source-resolver.ts')],
      outfile: resolve(rootDir, 'dist/source-resolver.mjs'),
    }),
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/project-indexer.ts')],
      outfile: resolve(rootDir, 'dist/project-indexer.mjs'),
      define: {
        __CRUX_INDEXER_VERSION__: JSON.stringify(indexerPackage.version),
      },
    }),
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/project-semantic-indexer.ts')],
      outfile: resolve(rootDir, 'dist/project-semantic-indexer.mjs'),
    }),
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/project-runtime-indexer.ts')],
      outfile: resolve(rootDir, 'dist/project-runtime-indexer.mjs'),
    }),
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/runtime-worker.ts')],
      outfile: resolve(rootDir, 'dist/runtime-worker.mjs'),
    }),
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/anydoc-runner.ts')],
      outfile: resolve(rootDir, 'dist/anydoc-runner.mjs'),
      // Anydoc is a pinned N-API package. Keep it external so its platform
      // addon is extracted beside the runner rather than bundled as JS.
      external: [...shared.external, '@firecrawl/anydoc'],
    }),
  ])
  await packageAnydocRuntime()
  console.log(
    `Built dist/eval-coordinator.mjs (${evalResult.errors.length} errors), ` +
      `dist/source-resolver.mjs (${resolverResult.errors.length} errors), ` +
      `dist/project-indexer.mjs (${indexerResult.errors.length} errors), ` +
      `dist/project-semantic-indexer.mjs (${semanticIndexerResult.errors.length} errors), ` +
      `dist/project-runtime-indexer.mjs (${runtimeIndexerResult.errors.length} errors), ` +
      `dist/runtime-worker.mjs (${runtimeWorkerResult.errors.length} errors), ` +
      `dist/anydoc-runner.mjs (${anydocRunnerResult.errors.length} errors)`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('installed esbuild for another platform')) {
    console.error(
      [
        'Failed to build the bundled local worker package because esbuild was installed for a different platform.',
        'This commonly happens when the repo is installed in WSL/Linux and the build is run from Windows, or vice versa.',
        'Run the build from the same environment that installed node_modules, or reinstall dependencies in the active environment.',
      ].join('\n'),
    )
    process.exit(1)
  }
  throw error
}

async function packageAnydocRuntime() {
  const runtime = resolve(distDir, 'anydoc-runtime')
  const packages = [
    ['@firecrawl/anydoc', ['index.js', 'package.json']],
    ['@firecrawl/anydoc-linux-x64-gnu', ['anydoc.linux-x64-gnu.node', 'package.json']],
  ]
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  await cp(resolve(distDir, 'anydoc-runner.mjs'), resolve(runtime, 'runner.mjs'))
  const manifestPackages = {}
  for (const [name, files] of packages) {
    const anydocSource = await realpath(resolve(rootDir, 'node_modules/@firecrawl/anydoc'))
    const source = name === '@firecrawl/anydoc' ? anydocSource : resolve(dirname(anydocSource), 'anydoc-linux-x64-gnu')
    const packageJSON = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'))
    if (packageJSON.version !== '0.1.7') throw new Error(`${name} must be pinned to 0.1.7`)
    const target = resolve(runtime, 'node_modules', ...name.split('/'))
    await mkdir(target, { recursive: true, mode: 0o700 })
    for (const file of files) await cp(resolve(source, file), resolve(target, file), { dereference: false })
    manifestPackages[name] = { version: packageJSON.version, integrity: packageIntegrity(name) }
  }
  const files = await runtimeFiles(runtime)
  await writeFile(resolve(runtime, 'manifest.json'), JSON.stringify({ version: 1, platform: 'linux-x64-gnu', packages: manifestPackages, files }, null, 2) + '\n', { mode: 0o600 })
}

function packageIntegrity(name) {
  const match = lockfile.match(new RegExp(`'${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}@0\\.1\\.7':[\\s\\S]*?integrity: (sha512-[A-Za-z0-9+/=]+)`))
  if (!match) throw new Error(`missing lockfile integrity for ${name}`)
  return match[1]
}

async function runtimeFiles(runtime) {
  const paths = ['runner.mjs', 'node_modules/@firecrawl/anydoc/index.js', 'node_modules/@firecrawl/anydoc/package.json', 'node_modules/@firecrawl/anydoc-linux-x64-gnu/anydoc.linux-x64-gnu.node', 'node_modules/@firecrawl/anydoc-linux-x64-gnu/package.json']
  return Promise.all(paths.map(async (path) => {
    const content = await readFile(resolve(runtime, path))
    const info = await stat(resolve(runtime, path))
    return { path, sha256: createHash('sha256').update(content).digest('hex'), size: info.size, mode: path.endsWith('.node') ? '0644' : '0644' }
  }))
}
