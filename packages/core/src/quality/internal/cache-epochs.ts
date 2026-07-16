/** Portable Quality/Eval cache epochs shared by runtime-neutral identity code. @internal */

/** Bump when normalized-call construction changes in a way not captured by its inputs. */
export const CASSETTE_CACHE_EPOCH = 3;

/** Bump when cell/output evidence identity or reuse semantics change. */
export const OUTPUT_CACHE_EPOCH = 3;

/** Bump when managed external-scorer result identity changes. */
export const SCORER_RESULT_CACHE_EPOCH = 1;

/** Bump when baseline config-fingerprint composition changes. */
export const BASELINE_FINGERPRINT_EPOCH = 2;

/** Bump when the built-in judge prompt template changes. */
export const JUDGE_PROMPT_VERSION = 1;
