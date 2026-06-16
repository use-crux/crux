import { build } from 'esbuild'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')

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
  const [qualityResult, resolverResult, indexerResult] = await Promise.all([
    build({
      ...shared,
      entryPoints: [resolve(rootDir, 'bin/quality-runner.ts')],
      outfile: resolve(rootDir, 'dist/quality-runner.mjs'),
      // NEVER bundle @crux/core into the quality runner: the worker must
      // share the PROJECT's core instance (internal symbols, observability
      // globals) — see lib/quality-core-bridge.ts. Type-only imports vanish;
      // an accidental runtime import fails loudly at extract time instead of
      // silently forking the module graph.
      external: [...shared.external, '@crux/core', '@crux/core/*'],
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
    }),
  ])
  console.log(
    `Built dist/quality-runner.mjs (${qualityResult.errors.length} errors), ` +
      `dist/source-resolver.mjs (${resolverResult.errors.length} errors), ` +
      `dist/project-indexer.mjs (${indexerResult.errors.length} errors)`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('installed esbuild for another platform')) {
    console.error(
      [
        'Failed to build the bundled devtools server because esbuild was installed for a different platform.',
        'This commonly happens when the repo is installed in WSL/Linux and the build is run from Windows, or vice versa.',
        'Run the build from the same environment that installed node_modules, or reinstall dependencies in the active environment.',
      ].join('\n'),
    )
    process.exit(1)
  }
  throw error
}
