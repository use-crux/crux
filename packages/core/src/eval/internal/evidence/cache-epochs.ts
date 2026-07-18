/** Portable Eval cache epochs shared by runtime-neutral identity code. @internal */

/** Bump when task-evidence identity or reuse semantics change. */
export const TASK_EVIDENCE_CACHE_EPOCH = 9;

/** Bump when managed external-scorer result identity changes. */
export const SCORER_RESULT_CACHE_EPOCH = 3;

/** Bump when baseline config-fingerprint composition changes. */
export const BASELINE_FINGERPRINT_EPOCH = 4;

/** Bump when the built-in judge prompt template changes. */
export const JUDGE_PROMPT_VERSION = 1;
