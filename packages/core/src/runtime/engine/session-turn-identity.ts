/** Stable identities shared by one Session activation and canonical Work. */

import { sha256Hex } from "../../content/sha256";
import type { EffectScopeRef } from "../../effect";
import type { WorkId } from "../ports/ids";

const encoder = new TextEncoder();

/** Derive one Work ID and Effect scope from an activation's primary input. */
export function sessionTurnIdentity(
  namespace: string,
  sessionId: string,
  inputId: string,
): { readonly workId: WorkId; readonly effects: EffectScopeRef } {
  const hash = sha256Hex(
    encoder.encode(
      JSON.stringify(["crux-session-turn:v1", namespace, sessionId, inputId]),
    ),
  );
  const workId = `work_${hash}` as WorkId;
  return Object.freeze({
    workId,
    effects: Object.freeze({
      kind: "effect.scope",
      id: `effect_${hash}`,
      runId: workId,
    }),
  });
}
