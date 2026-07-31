/**
 * Cleanup and stable failures for edits rejected after node preparation.
 *
 * @module
 */

import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import { threadControlKey, threadNodeKey } from "./keys";
import { cleanupUnreferencedThreadAssets } from "./nodes";
import { isNodePublished } from "./path";
import {
  parseThreadControlRecord,
  type ThreadControlRecord,
  type ThreadLiveNodeRecord,
} from "./records";

/**
 * Erase an edit replacement after its target's redaction is published.
 *
 * The redaction is the fence preventing any later edit mutation from
 * publishing this replacement after the reachability check.
 */
export async function cleanupUnpublishedThreadEdit(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  replacement: ThreadLiveNodeRecord,
): Promise<boolean> {
  if (
    await isNodePublished(storage, threadId, control, replacement.id)
  ) {
    return false;
  }
  if (replacement.assetRefs.length > 0 && !storage.assets) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" cannot erase an unpublished edit without its owning AssetStore.`,
    );
  }
  for (const uri of replacement.assetRefs) {
    await storage.assets!.delete({ uri });
  }
  await storage.records.delete(threadNodeKey(threadId, replacement.id));
  return true;
}

/** Release one edit attempt's unpublished node and staging assets. */
export async function cleanupPreparedThreadEdit(
  storage: Storage,
  threadId: string,
  prepared: readonly { readonly assetRefs: readonly string[] }[],
  ownedReplacement?: ThreadLiveNodeRecord,
): Promise<void> {
  let erasedOwnedNode = false;
  if (ownedReplacement) {
    const current = await storage.records.get(threadControlKey(threadId));
    if (current) {
      erasedOwnedNode = await cleanupUnpublishedThreadEdit(
        storage,
        threadId,
        parseThreadControlRecord(current),
        ownedReplacement,
      );
    }
  }
  if (!erasedOwnedNode) {
    await cleanupUnreferencedThreadAssets(
      storage,
      threadId,
      prepared.flatMap(({ assetRefs }) => assetRefs.map((uri) => ({ uri }))),
    );
  }
}

/** Create the permanent edit-poisoning failure for one redacted target. */
export function redactedEditTarget(
  threadId: string,
  messageId: string,
): ThreadError {
  return new ThreadError(
    "redacted",
    `Edit target "${messageId}" in Thread "${threadId}" has been redacted.`,
  );
}
