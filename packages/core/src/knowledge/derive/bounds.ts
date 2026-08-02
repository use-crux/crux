/**
 * Shared prompt bounds for connected-knowledge derivation.
 *
 * @module
 */

/** Extraction prompt/cache shape version; bump when generated derive output semantics change. */
export const EXTRACTION_CONTRACT_VERSION = 2

/** Maximum estimated content characters assigned to one generated derive batch. */
export const MAX_DERIVE_BATCH_CHARS = 12000

/** Maximum characters sent in one connected-knowledge derive prompt or repair prompt. */
export const MAX_DERIVE_PROMPT_CHARS = MAX_DERIVE_BATCH_CHARS
