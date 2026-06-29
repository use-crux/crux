/**
 * Plugin system for composable runtime hook installation.
 *
 * Plugins receive the current runtime state and return a partial patch that is
 * merged using fan-out semantics for per-call hooks and layered chaining for
 * middleware (new wraps old). The merge mechanics live in
 * `./merge-runtime`; this module owns the plugin contract and the ordered
 * `applyPlugins()` orchestration.
 *
 * @module
 */

import type { CruxRuntime } from './runtime'
import { mergeRuntime } from './merge-runtime'

// Re-export the merge entry point so `@use-crux/core` and intra-package callers
// keep a single `plugin` import site for plugin composition.
export { mergeRuntime } from './merge-runtime'

// ─────────────────────────────────────────────────────────────────
// Plugin interface
// ─────────────────────────────────────────────────────────────────

/**
 * Result returned by a plugin's `install()` method.
 *
 * Contains partial runtime fields to merge plus an optional `dispose`
 * function for cleanup when the registry is torn down.
 */
export interface CruxPluginResult extends Partial<CruxRuntime> {
  /** Called when the plugin is uninstalled (registry.dispose()). */
  dispose?: () => void
}

/**
 * A composable plugin that hooks into the Crux runtime.
 *
 * Plugins are installed in order via `config({ plugins: [...] })`.
 * Each plugin's `install()` receives the cumulative runtime from all
 * prior plugins, enabling layered composition.
 *
 * @example
 * ```ts
 * import type { CruxPlugin } from '@use-crux/core'
 *
 * const myPlugin: CruxPlugin = {
 *   name: 'my-tracer',
 *   install(runtime) {
 *     const unsubscribe = subscribeObservability((record) => console.log(record.type))
 *     return { dispose: unsubscribe }
 *   },
 * }
 * ```
 */
export interface CruxPlugin {
  /** Unique plugin name for debugging and error messages. */
  readonly name: string
  /**
   * Install the plugin. Receives the cumulative runtime. Returns runtime
   * fields to merge.
   *
   * @param runtime - Frozen snapshot of the current cumulative runtime.
   * @returns Partial runtime patch with optional dispose function.
   */
  install(runtime: Readonly<CruxRuntime>): CruxPluginResult
}

// ─────────────────────────────────────────────────────────────────
// applyPlugins
// ─────────────────────────────────────────────────────────────────

/** Result of applying plugins — the merged runtime and a combined dispose function. */
export interface ApplyPluginsResult {
  /** The merged runtime after all plugins have been applied. */
  runtime: CruxRuntime
  /** Dispose all plugins in reverse order. */
  dispose: () => void
}

/**
 * Apply an ordered list of plugins to an initial runtime.
 *
 * Each plugin's `install()` receives the cumulative runtime from all
 * prior plugins. Results are merged using {@link mergeRuntime}.
 * Dispose functions are collected and called in reverse order.
 *
 * @param plugins - Ordered list of plugins to apply.
 * @param initialRuntime - The base runtime before any plugins.
 * @returns The final merged runtime and a combined dispose function.
 *
 * @example
 * ```ts
 * const { runtime, dispose } = applyPlugins(
 *   [withDevtools({ serverUrl }), withTelemetry({ serviceName: 'app' })],
 *   getRuntime(),
 * )
 * setRuntime(runtime)
 * // later: dispose()
 * ```
 */
export function applyPlugins(plugins: ReadonlyArray<CruxPlugin>, initialRuntime: CruxRuntime): ApplyPluginsResult {
  const disposeFns: Array<() => void> = []
  let runtime = { ...initialRuntime }

  for (const plugin of plugins) {
    const { dispose, ...patch } = plugin.install(Object.freeze({ ...runtime }))
    runtime = mergeRuntime(runtime, patch)
    if (dispose) {
      disposeFns.push(dispose)
    }
  }

  return {
    runtime,
    dispose() {
      // Reverse order: last installed → first disposed
      for (let i = disposeFns.length - 1; i >= 0; i--) {
        disposeFns[i]()
      }
    },
  }
}
