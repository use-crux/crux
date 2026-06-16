/**
 * Quality project configuration — the `quality:` block of `crux.config.ts`
 * (spec 01 §9). Read by the `crux quality` runner at collect time; never
 * imported by application runtime code.
 *
 * Replaces the legacy `eval:` block for the Quality system. The legacy
 * `QualityConfig` in `quality/types.ts` (workbench records) coexists until
 * the legacy surface is removed.
 *
 * @module
 */

import type { GenerateFn, ModelRef } from './target'
import type { ReplayMode } from './replay'
import type { EmbedFn } from './scorers'

/**
 * Ambient execution providers resolved once per run by {@link QualityConfig.setup}.
 *
 * The runner calls `setup()` lazily — only when at least one selected
 * evaluation needs a model-backed task or a judge scorer — so importing
 * heavy SDK clients stays out of collect time.
 */
export interface QualitySetupResult {
  /** The adapter generate function (e.g. `generate` from `@crux/ai`). */
  generate: GenerateFn
  /** Default model for tasks that don't specify one. */
  model?: ModelRef
  /** Named models referencable in `params`/`variants` as strings. */
  models?: Record<string, ModelRef>
  /** Default judge model for model-backed scorers (falls back to `model`). */
  judgeModel?: ModelRef
  /** Embedding provider for `scorers.embeddingSimilarity`. */
  embed?: EmbedFn
}

/**
 * Project configuration for the Quality system — the `quality:` key of
 * `crux.config.ts`.
 *
 * Every field is optional: an empty object (or no `quality:` key at all)
 * gives a working zero-config setup — `*.eval.ts` discovery from the config
 * directory, persistence under `.crux/quality/`, and the package name as the
 * workbench id.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@crux/core'
 *
 * export default config({
 *   prompts,
 *   quality: {
 *     id: 'acme-backend',
 *     include: './evals/**\/*.eval.ts',
 *     setup: async () => {
 *       const { generate } = await import('@crux/ai')
 *       const { createClient } = await import('./src/models')
 *       const client = createClient()
 *       return {
 *         generate,
 *         model: client.model('anthropic/claude-sonnet-4-6'),
 *         models: { cheap: client.model('openai/gpt-4.1-nano') },
 *       }
 *     },
 *     defaults: { trials: 1, concurrency: 5, timeoutMs: 60_000 },
 *   },
 * })
 * ```
 */
export interface QualityConfig {
  /**
   * Workbench id (experiment provenance — `qualityId` on every record).
   *
   * @default the nearest package.json name
   */
  id?: string
  /**
   * Persistence root. `baselines/` inside it is committed to the repo;
   * `experiments/` is gitignored (the runner scaffolds the `.gitignore`).
   *
   * @default '.crux/quality'
   */
  dir?: string
  /**
   * Discovery glob(s) for evaluation files, relative to the config
   * directory.
   *
   * @default ['**\/*.eval.ts'] excluding node_modules and dist
   */
  include?: string | readonly string[]
  /** Extra glob(s) to exclude from discovery. */
  exclude?: string | readonly string[]
  /**
   * Ambient execution providers for model-backed tasks and judge scorers.
   * Called lazily, at most once per run.
   */
  setup?: () => Promise<QualitySetupResult>
  /**
   * Dot-path redaction applied to cassettes and persisted records.
   * Always-on defaults (authorization headers, api keys) apply regardless.
   */
  redact?: readonly string[]
  /** Run defaults, overridable per evaluation and per CLI invocation. */
  defaults?: {
    /** @default 1 */
    trials?: number
    /** @default 5 */
    concurrency?: number
    /** @default 60_000 */
    timeoutMs?: number
    /** @default 'live' */
    replay?: ReplayMode
  }
}
