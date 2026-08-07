/**
 * Effective stream cursor/status resolution under config identity.
 *
 * @remarks Pure over the durable checkpoint and live binding configRef.
 * Changed config over-invalidates prior cursor and non-active status so a new
 * config identity can open without inheriting a prior fault/disable.
 *
 * @module
 */

import type {
  RuntimeTransportBindingCheckpoint,
  RuntimeTransportBindingStatus,
} from "../transport/binding-checkpoint";
import type { RuntimeTransportConfigRef } from "../transport/contracts";
import { sameTransportConfigRef } from "./worker-transport-stream-connection";

/** Effective supervision view before a stream open attempt. */
export interface ResolvedStreamCheckpoint {
  /**
   * Cursor passed to `open`, or `null` when none / config invalidates.
   */
  readonly cursor: string | null;
  /**
   * Effective status under the live config identity.
   *
   * @remarks Config mismatch always yields `"active"` so prior faulted/disabled
   * rows under an old configRef do not block the new identity.
   */
  readonly status: RuntimeTransportBindingStatus;
  /**
   * When true, supervision must not open (and should not claim a binding lease
   * solely to sit idle). Safe because checkpoint reads are unfenced and this
   * path performs no status write.
   */
  readonly skipOpen: boolean;
  /** True when a stored configRef exists and equals the live binding configRef. */
  readonly configMatched: boolean;
}

/**
 * Resolve the effective stream cursor and skip decision for one binding.
 *
 * @param checkpoint - Durable checkpoint row, or `null` when absent.
 * @param configRef - Live binding config identity (existing id/revision shape).
 */
export function resolveStreamCheckpoint(
  checkpoint: RuntimeTransportBindingCheckpoint | null,
  configRef: RuntimeTransportConfigRef,
): ResolvedStreamCheckpoint {
  if (checkpoint === null) {
    return {
      cursor: null,
      status: "active",
      skipOpen: false,
      configMatched: false,
    };
  }

  const storedRef = checkpoint.configRef;
  const configMatched =
    storedRef !== undefined && sameTransportConfigRef(storedRef, configRef);

  if (!configMatched) {
    // Over-invalidate: new config identity starts clean.
    return {
      cursor: null,
      status: "active",
      skipOpen: false,
      configMatched: false,
    };
  }

  const status = normalizeStatus(checkpoint.status);
  return {
    cursor: checkpoint.cursor,
    status,
    skipOpen: status === "faulted" || status === "disabled",
    configMatched: true,
  };
}

function normalizeStatus(
  status: RuntimeTransportBindingStatus | undefined,
): RuntimeTransportBindingStatus {
  if (status === "faulted" || status === "disabled" || status === "active") {
    return status;
  }
  return "active";
}
