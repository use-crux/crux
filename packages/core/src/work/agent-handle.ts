/**
 * Agent-specific Work handle and process-local steering contracts.
 *
 * @module
 */

import type { MessageContent } from "../types/content";
import type { WorkHandle } from "./handle";

/**
 * Canonical supervisor guidance accepted by {@link AgentWorkHandle.send}.
 *
 * @remarks Prefer a plain string for ordinary text. Multimodal guidance uses the
 * same content-part contract as user messages. Steering never replaces the
 * child's typed assignment and cannot grant tools, models, or policy.
 */
export type AgentSteeringContent = MessageContent;

/**
 * Ordered acceptance cursor for one process-local steering command.
 *
 * @remarks Cursors increase with acceptance order for one Work occurrence.
 * They are valid only while the process-local activity root survives.
 */
export interface WorkSteeringCursor {
  /** Opaque, ordered position for this Work's steering stream. */
  readonly value: string;
}

/**
 * Receipt returned when steering is accepted for Agent Work.
 *
 * @remarks Acceptance acknowledges the command under the handle's process-local
 * guarantees. It does not mean the child has observed the guidance yet.
 * Delivery happens only at the next semantic provider-step boundary.
 */
export interface WorkSteeringReceipt {
  /** Stable command identity for this accepted send. */
  readonly id: string;
  /** Ordered acceptance cursor within the Work occurrence. */
  readonly cursor: WorkSteeringCursor;
  /** Wall-clock time when the command was first accepted. */
  readonly acceptedAt: Date;
  /** Stable acceptance outcome; exact replays return the same outcome. */
  readonly outcome: "accepted";
}

/**
 * Live Agent Work handle with canonical lifecycle plus Agent-only steering.
 *
 * @typeParam TResult - Exact successful result produced by the Agent.
 * @remarks Extends the shared {@link WorkHandle} contract. Flow and task Work
 * remain ordinary `WorkHandle` values and never expose `send` at the type level.
 * Process-local handles are honest about durability: process exit loses the
 * registry, pending steering, and rejoin capability.
 *
 * @example
 * ```ts
 * const child = await spawn(researcher, { task: "Investigate the regression." })
 * await child.send("Also compare the last two releases.")
 * const report = await child.result()
 * ```
 */
export interface AgentWorkHandle<TResult> extends WorkHandle<TResult> {
  /**
   * Accept ordered supervisor guidance for queued or running Agent Work.
   *
   * @param content - Canonical string or multimodal user-authored content.
   * @returns An idempotent acceptance receipt; delivery is deferred.
   * @remarks Accepted guidance is ordered and reaches the child only at the next
   * semantic provider-step boundary. It never mutates an active provider call,
   * expands child tools, or weakens guardrails. Terminal Work rejects.
   * @throws {TypeError} When content is empty or Work is not Agent-steerable.
   * @throws {WorkNotActiveError} When Work is already terminal.
   */
  send(content: AgentSteeringContent): Promise<WorkSteeringReceipt>;
}
