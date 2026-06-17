/**
 * Quality project configuration — the `quality:` block of `crux.config.ts`.
 * Read by the `crux quality` runner at collect time; never imported by
 * application runtime code.
 *
 * Replaces the legacy `eval:` block for the Quality system. The legacy
 * `QualityConfig` in `quality/types.ts` (workbench records) coexists until
 * the legacy surface is removed.
 *
 * @module
 */

import type { ReplayMode } from './replay'

/**
 * Project configuration for the Quality system — the `quality:` key of
 * `crux.config.ts`.
 *
 * Every field is optional: an empty object (or no `quality:` key at all)
 * gives a working zero-config setup: file-defined evaluations are discovered
 * from `evals/**\/*.eval.ts` and `**\/*.eval.ts`, records persist under
 * `.crux/quality/`, and the nearest package name becomes the workbench id
 * when one exists.
 *
 * Model, judge, and embedding providers are intentionally not configured
 * here. Bind live model work in eval code through `target.*` defaults,
 * `params`, `variants`, or small eval-local helper modules so the execution
 * path remains visible at the call site.
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
   * Discovery glob(s) for evaluation files, relative to the project root.
   *
   * @default ['evals/**\/*.eval.ts', '**\/*.eval.ts'] excluding node_modules and dist
   */
  include?: string | readonly string[]
  /** Extra glob(s) to exclude from discovery. */
  exclude?: string | readonly string[]
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
