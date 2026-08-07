/** Ordered, safe Session stream events. */

import type { SessionStatus } from "./types";

/** Options for resuming a Session event stream. */
export interface SessionStreamOptions {
  /**
   * Continue strictly after this opaque cursor.
   *
   * @remarks Without `after`, the stream emits one `session.snapshot`
   * (`reason: "initial"`) then every retained event from the earliest retained
   * position through the live tail. A valid `after` resumes strictly after that
   * cursor with no gaps or duplicates. When `after` is expired or unknown, the
   * stream emits `session.snapshot` with `reason: "cursor-expired"` then
   * continues from the earliest retained event. Snapshot events replace local
   * reducer state; subsequent retained events are replayed in order (including
   * events whose facts also appear in the snapshot). Slow consumers cannot
   * retain unbounded history — the durable event port bounds retention.
   */
  readonly after?: string;
}

interface SessionEventBase {
  /** Stable deduplication identity for this event. */
  readonly id: string;
  /** Opaque position accepted by {@link SessionStreamOptions.after}. */
  readonly cursor: string;
  /** Session that owns this event. */
  readonly sessionId: string;
  /** Time the Runtime appended this safe event. */
  readonly occurredAt: Date;
}

/** Payload-free accepted-ingress summary for stream consumers. */
export interface SessionIngressSummary {
  /** Stable accepted input identity. */
  readonly inputId: string;
  /** Server-assigned Session-local acceptance cursor. */
  readonly cursor: string;
  /** Ingress source kind. */
  readonly source: "send" | "signal";
}

/**
 * A deduplicable lifecycle or ingress event for one durable Session.
 *
 * @remarks Streams carry safe snapshots and ordering facts only. They never
 * retain raw tokens, prompt text, or private input payloads.
 */
export type SessionEvent =
  | (SessionEventBase & {
      readonly type: "session.snapshot";
      readonly reason: "initial" | "cursor-expired";
      readonly status: SessionStatus;
    })
  | (SessionEventBase & {
      readonly type: "session.status";
      readonly status: SessionStatus;
    })
  | (SessionEventBase & {
      readonly type: "ingress.accepted";
      readonly ingress: SessionIngressSummary;
    })
  | (SessionEventBase & {
      readonly type: "ingress.delivered";
      readonly ingress: SessionIngressSummary;
      readonly stepIndex: number;
      /** Canonical Work identity when delivery linked the input to a turn. */
      readonly workId?: string;
    });
