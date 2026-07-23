/** Portable Eval cache epochs shared by runtime-neutral identity code. @internal */

/**
 * Bump when task-evidence identity or reuse semantics change.
 *
 * 10: structured-output normalization changed observable task output
 * (`result.object` is now the authored Zod `safeParse.data`, and tool call
 * arguments are decoded + Zod-validated before execution) without changing the
 * adapter fingerprint, so pre-normalization cached task outputs are stale.
 */
export const TASK_EVIDENCE_CACHE_EPOCH = 10;

/** Bump when managed external-scorer result identity changes. */
export const SCORER_RESULT_CACHE_EPOCH = 3;

/** Bump when baseline config-fingerprint composition changes. */
export const BASELINE_FINGERPRINT_EPOCH = 4;

/** Bump when the built-in judge prompt template changes. */
export const JUDGE_PROMPT_VERSION = 1;
