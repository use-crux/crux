/** In-memory Session lifecycle transitions: close, kill, delete, fork. */

import type { RuntimeSessionRecord } from "../../ports/sessions";
import {
  sessionAcceptsIngress as acceptsIngress,
  sessionHoldsCommitAuthority as holdsCommitAuthority,
} from "../../../session/lifecycle-state";

export {
  closeMemorySession,
  deactivateSessionSubscriptions,
  killMemorySession,
  maybeFinalizeClosingSession,
} from "./session-controls-close";
export {
  deleteMemorySession,
  forkMemorySession,
  listMemorySessionForks,
} from "./session-controls-delete-fork";

/** Whether Session state still accepts external ingress. */
export function sessionAcceptsIngress(session: RuntimeSessionRecord): boolean {
  return acceptsIngress(session.state);
}

/** Whether Session state still accepts Work mutation of its ledger. */
export function sessionAcceptsWorkMutation(
  session: RuntimeSessionRecord,
): boolean {
  return holdsCommitAuthority(session.state);
}
