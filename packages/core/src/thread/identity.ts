/**
 * Canonical Thread message identity.
 *
 * Hashing the private persisted-message representation makes replay equality
 * independent of object property order and provider SDK shapes.
 *
 * @module
 */

import { sha256Hex } from "../content/sha256";
import type { PersistedMessage } from "../content/persisted-message";
import { canonicalEvidenceJson } from "../evidence/canonical-json";

const TEXT_ENCODER = new TextEncoder();

/** Hash one normalized persisted message. */
export function threadMessageIdentity(message: PersistedMessage): string {
  return sha256Hex(TEXT_ENCODER.encode(canonicalEvidenceJson(message)));
}

/** Hash structural causal-group identity from ordered canonical inputs. */
export function threadGroupIdentity(input: {
  readonly parentId: string | null;
  readonly messageIds: readonly string[];
  readonly identities: readonly string[];
}): string {
  return sha256Hex(TEXT_ENCODER.encode(canonicalEvidenceJson(input)));
}
