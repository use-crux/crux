/**
 * Unified domain configuration for Crux.
 *
 * `config()` is the single public API for configuring project policy and
 * explicit runtime behavior. Prompt, context, tool, and registry construction
 * remains normal TypeScript code; local tooling discovers those authored values
 * from source rather than requiring duplicate config registration.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@use-crux/core'
 * import { inMemoryRecordStore } from '@use-crux/core/storage'
 *
 * export default config({
 *   lint: { profile: 'recommended' },
 *   persistence: {
 *     records: inMemoryRecordStore(),
 *   },
 *   generation: {
 *     tokenizer: (text) => Math.ceil(text.length / 4),
 *   },
 * })
 * ```
 *
 * @module
 */

import type { PromptRegistry } from "./configure";
import type { CruxConfig } from "./config-types";
import { configure } from "./configure";
import { createRuntimeConfigTransaction } from "./config-transaction";
import type { CruxFlowRuntimeControls } from "./api/flows";
import { getCruxProcessRegistry } from "./process-registry";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type {
  CruxConfig,
  CruxDevtoolsConfig,
  CruxExperimentalConfig,
  CruxExperimentalIndexerConfig,
  CruxExperimentalIndexerNativeAstConfig,
  CruxExperimentalIndexerNativeConfig,
  CruxExperimentalIndexerNativeEngine,
  CruxGenerationConfig,
  CruxIndexerConfig,
  CruxIndexerExtensionReference,
  CruxIndexerExtensionTrustMode,
  CruxIndexerExtensionTrustPolicy,
  CruxLintConfig,
  CruxLintRuleConfig,
  CruxLintSelectedProfile,
  CruxObservabilityConfig,
  CruxPersistenceConfig,
  CruxRuntimeConfig,
} from "./config-types";
export type {
  CruxExperimentalEvalConfig,
  CruxExperimentalEvalPrice,
} from "./eval-config";

/**
 * Crux instance returned by `config()`.
 * Extends `PromptRegistry` with access to the raw config.
 */
export interface Crux extends PromptRegistry {
  /** The raw project configuration. */
  readonly config: Readonly<CruxConfig>;
  /** Name-bound Runtime Engine flow controls. */
  readonly flows: CruxFlowRuntimeControls;
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

const runtimeRegistry = getCruxProcessRegistry().runtime;

/**
 * Define and apply Crux configuration.
 *
 * Immediately sets up globals for the configured domains and returns a
 * `Crux` instance with access to the raw config. Authored primitives are
 * discovered from source; `config()` no longer registers prompts, contexts,
 * tools, or registries.
 *
 * This is the **only** public API for project configuration. Module caching
 * ensures a `crux.config.ts` module runs exactly once per process.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@use-crux/core'
 *
 * export default config({
 *   lint: { profile: 'recommended' },
 *   persistence: { records },
 *   generation: { middleware, tokenizer },
 *   observability: { serverUrl: process.env.CRUX_OBSERVABILITY_URL },
 * })
 * ```
 */
export function config(config: CruxConfig): Crux {
  const transaction = createRuntimeConfigTransaction({ config });
  if (transaction.inert) return transaction.createCrux();

  runtimeRegistry.activeInstallation?.restore();
  runtimeRegistry.activeInstallation = undefined;
  const installation = transaction.apply();
  runtimeRegistry.activeInstallation = installation;
  const registry = configure(transaction.configureOptions);
  const bridgeConnection = installation.connectBridge(registry);
  const crux = installation.createCrux(registry, bridgeConnection);

  return Object.freeze({
    ...crux,
    dispose() {
      crux.dispose();
      if (runtimeRegistry.activeInstallation === installation) {
        runtimeRegistry.activeInstallation = undefined;
      }
    },
  }) as Crux;
}
