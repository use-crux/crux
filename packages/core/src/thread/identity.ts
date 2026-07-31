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
export function threadMessageIdentity(
  message: PersistedMessage,
  ownedAssetRefs: readonly string[] = [],
): string {
  return sha256Hex(
    TEXT_ENCODER.encode(canonicalEvidenceJson(
      projectAssetIdentity(message, new Set(ownedAssetRefs)),
    )),
  );
}

function projectAssetIdentity(
  message: PersistedMessage,
  ownedAssetRefs: ReadonlySet<string>,
): PersistedMessage {
  if (typeof message.content === "string") return message;
  return {
    ...message,
    content: message.content.map((part) => {
      if (
        !("source" in part) ||
        part.source.type !== "asset-ref" ||
        !ownedAssetRefs.has(part.source.ref.uri) ||
        !part.source.info?.sha256
      ) {
        return part;
      }
      return {
        ...part,
        source: {
          ...part.source,
          ref: { uri: `sha256:${part.source.info.sha256}` },
        },
      };
    }),
  } as PersistedMessage;
}

/** Hash structural causal-group identity from ordered canonical inputs. */
export function threadGroupIdentity(input: {
  readonly parentId: string | null;
  readonly messageIds: readonly string[];
  readonly identities: readonly string[];
}): string {
  return sha256Hex(TEXT_ENCODER.encode(canonicalEvidenceJson(input)));
}
