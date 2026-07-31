/**
 * Canonical Thread message hydration.
 *
 * Thread nodes retain the private persisted-message form so media can stay in
 * the owning AssetStore. Reads cross that boundary here and always return the
 * application-facing message shape, including hydrated stored assets.
 *
 * @module
 */

import { decodePersistedMessages } from "../../content/persisted-message";
import type { Message } from "../../generation/messages";
import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import type { ThreadLiveNodeRecord } from "./records";

/** Hydrate one live node into its canonical application-facing message. */
export async function hydrateThreadMessage(
  storage: Storage,
  node: ThreadLiveNodeRecord,
): Promise<Message> {
  const [message] = await decodePersistedMessages({
    storage,
    messages: [node.message],
  });
  if (!message) {
    throw new ThreadError(
      "commit_failed",
      "Stored Thread message could not be decoded.",
    );
  }
  return message;
}
