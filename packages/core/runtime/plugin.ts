/**
 * Plugin system for composable hook installation.
 *
 * Plugins receive the current hook state and return a partial patch that is
 * merged using fan-out semantics for per-call hooks and layered chaining for
 * middleware (new wraps old). The merge mechanics live in
 * `./merge-runtime`; this module owns the plugin contract and the ordered
 * `applyPlugins()` orchestration.
 *
 * @module
 */

import type { CruxHooks } from './runtime'
import { mergeHooks } from './merge-runtime'

// Re-export the merge entry point so `@use-crux/core` and intra-package callers
// keep a single `plugin` import site for plugin composition.
export { mergeHooks } from './merge-runtime'

// ─────────────────────────────────────────────────────────────────
// Plugin interface
// ─────────────────────────────────────────────────────────────────

/**
 * Result returned by a plugin's `install()` method.
 *
 * Contains partial hook fields to merge plus an optional `dispose`
 * function for cleanup when the registry is torn down.
 */
export interface CruxPluginResult extends Partial<CruxHooks> {
  /**
   * Called when the plugin is uninstalled.
   *
   * Return a promise when cleanup must drain asynchronous resources, such as
 * telemetry transports, before restoring the previous hook layer.
   */
  dispose?: () => void | Promise<void>
}

/**
 * A composable plugin that hooks into Crux.
 *
 * Plugins are installed in order via `config({ plugins: [...] })`.
 * Each plugin's `install()` receives the cumulative hooks from all
 * prior plugins, enabling layered composition.
 *
 * @example
 * ```ts
 * import type { CruxPlugin } from '@use-crux/core'
 *
 * const myPlugin: CruxPlugin = {
 *   name: 'my-tracer',
 *   install(hooks) {
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
   * Install the plugin. Receives the cumulative hook state. Returns hook
   * fields to merge.
   *
   * @param hooks - Frozen snapshot of the current cumulative hook state.
   * @returns Partial hook patch with optional dispose function.
   */
  install(hooks: Readonly<CruxHooks>): CruxPluginResult
}

// ─────────────────────────────────────────────────────────────────
// applyPlugins
// ─────────────────────────────────────────────────────────────────

/** Result of applying plugins — the merged hooks and a combined dispose function. */
export interface ApplyPluginsResult {
  /** The merged hooks after all plugins have been applied. */
  hooks: CruxHooks
  /** Dispose all plugins in reverse order. */
  dispose: () => Promise<void>
}

/**
 * Apply an ordered list of plugins to an initial hook state.
 *
 * Each plugin's `install()` receives the cumulative hook state from all
 * prior plugins. Results are merged using {@link mergeHooks}.
 * Dispose functions are collected and called in reverse order.
 *
 * @param plugins - Ordered list of plugins to apply.
 * @param initialHooks - The base hook state before any plugins.
 * @returns The final merged hooks and a combined dispose function.
 *
 * @example
 * ```ts
 * const { hooks, dispose } = applyPlugins(
 *   [withDevtools({ serverUrl }), withTelemetry({ serviceName: 'app' })],
 *   getHooks(),
 * )
 * setHooks(hooks)
 * // later: dispose()
 * ```
 */
export function applyPlugins(
  plugins: ReadonlyArray<CruxPlugin>,
  initialHooks: CruxHooks,
): ApplyPluginsResult {
  const disposeFns: Array<() => void | Promise<void>> = []
  let hooks = { ...initialHooks }

  for (const plugin of plugins) {
    const { dispose, ...patch } = plugin.install(Object.freeze({ ...hooks }))
    hooks = mergeHooks(hooks, patch)
    if (dispose) {
      disposeFns.push(dispose)
    }
  }

  return {
    hooks,
    dispose() {
      // Reverse order: last installed → first disposed
      const pending: Promise<void>[] = []
      for (let i = disposeFns.length - 1; i >= 0; i--) {
        try {
          const result = disposeFns[i]()
          if (result !== undefined) pending.push(Promise.resolve(result))
        } catch (error) {
          pending.push(Promise.reject(error))
        }
      }
      return Promise.all(pending).then(() => undefined)
    },
  }
}
