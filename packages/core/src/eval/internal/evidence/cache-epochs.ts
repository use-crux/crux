/** Portable Eval cache epochs shared by runtime-neutral identity code. @internal */

/**
 * Bump when task-evidence identity or reuse semantics change.
 *
 * 11: effective Eval/Case timeout policy now participates in exact evidence
 * identity, so evidence from the policy-unaware epoch must not be reused.
 * 12: accepted preparation amendments and pinned control-resource revisions
 * participate in provider-call decisions, invalidating earlier task evidence.
 * 13: host storage capabilities use the canonical search-store name, so older
 * storage-capability evidence contracts must not be reused.
 */
export const TASK_EVIDENCE_CACHE_EPOCH = 13;

/** Bump when managed external-scorer result identity changes. */
export const SCORER_RESULT_CACHE_EPOCH = 3;

/**
 * Bump when Baseline coverage or provenance fingerprint composition changes.
 *
 * 5: per-trial terminal outcomes now participate in coverage and snapshot
 * identity, so outcome-unaware Baselines must be explicitly repromoted.
 */
export const BASELINE_FINGERPRINT_EPOCH = 5;

/** Bump when the built-in judge prompt template changes. */
export const JUDGE_PROMPT_VERSION = 1;
