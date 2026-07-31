/**
 * Thread revision identity for request-plan pinning.
 *
 * The fingerprint is derived from the existing mutable control record. It is
 * not a second counter: head movement and visibility mutations already publish
 * through that record and therefore change this revision.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import { canonicalEvidenceJson } from "../../evidence/canonical-json";
import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import { threadControlKey } from "./keys";
import {
  parseThreadControlRecord,
  type ThreadControlRecord,
} from "./records";

const encoder = new TextEncoder();

/** Fingerprint the canonical-history state carried by one control record. */
export function threadControlRevision(
  control: ThreadControlRecord | undefined,
): string {
  return sha256Hex(
    encoder.encode(
      canonicalEvidenceJson(
        control
          ? {
              state: control.state,
              heads: control.heads,
              redactions: control.redactions,
              removals: control.removals,
              updatedAt: control.updatedAt,
            }
          : { state: "empty" },
      ),
    ),
  );
}

/** Read only the current control-record revision. */
export async function readThreadRevision(
  storage: Storage,
  threadId: string,
): Promise<string> {
  const raw = await storage.records.get(threadControlKey(threadId));
  if (!raw) return threadControlRevision(undefined);
  const control = parseThreadControlRecord(raw);
  if (control.state === "deleted") {
    throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
  }
  return threadControlRevision(control);
}
