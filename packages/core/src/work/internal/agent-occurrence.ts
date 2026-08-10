/**
 * Stable process-local identity for Agent-tool Work occurrences.
 *
 * Identity derives from owner execution, turn/step, tool-call, and binding key
 * so provider or adapter replay reconnects the existing child instead of
 * starting another. Separate parent runs must not share occurrence partitions.
 *
 * @internal
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import { canonicalRuntimeJson } from "../../runtime/engine/canonical-json";
import type { JsonValue } from "../../storage";

const encoder = new TextEncoder();
let nextOwnerExecution = 0;

/** Composite key for one logical Agent-tool occurrence. */
export interface AgentToolOccurrenceKey {
  /** Owner execution identity that accepted the child (not Agent definition id). */
  readonly ownerId: string;
  /** Parent turn or step occurrence identity within the owner execution. */
  readonly turnId: string;
  /** Normalized provider Tool-call occurrence identity. */
  readonly toolCallId: string;
  /** Authored Tool-map binding key for the child. */
  readonly bindingKey: string;
}

/** Pinned evidence retained for conflict detection. */
export interface AgentToolOccurrenceRecord {
  readonly key: AgentToolOccurrenceKey;
  readonly workId: string;
  readonly inputHash: string;
}

/** Process-local occurrence registry for Agent-tool spawns. @internal */
export interface AgentToolOccurrenceRegistry {
  /**
   * Return an existing occurrence or reserve a new one for the provided work id.
   *
   * @throws {TypeError} When the same occurrence is reused with different input.
   */
  accept(
    key: AgentToolOccurrenceKey,
    input: unknown,
    workId: string,
  ): AgentToolOccurrenceRecord;
  /** Look up a reserved occurrence without allocating. */
  get(key: AgentToolOccurrenceKey): AgentToolOccurrenceRecord | undefined;
  /** Drop one occurrence entry when in-turn replay is no longer required. */
  release(key: AgentToolOccurrenceKey): void;
  /** Drop every occurrence reserved by one parent owner execution. */
  releaseOwner(ownerId: string): void;
  /** Number of retained occurrence entries (tests and diagnostics). */
  size(): number;
}

/** Create one isolated occurrence registry. */
export function createAgentToolOccurrenceRegistry(): AgentToolOccurrenceRegistry {
  const records = new Map<string, AgentToolOccurrenceRecord>();

  return Object.freeze({
    accept(
      key: AgentToolOccurrenceKey,
      input: unknown,
      workId: string,
    ): AgentToolOccurrenceRecord {
      const identity = encodeOccurrenceKey(key);
      const inputHash = hashOccurrenceInput(input);
      const existing = records.get(identity);
      if (existing) {
        if (existing.inputHash !== inputHash) {
          throw new TypeError(
            "Agent-tool occurrence identity was reused with conflicting input.",
          );
        }
        return existing;
      }
      const record = Object.freeze({
        key: Object.freeze({ ...key }),
        workId,
        inputHash,
      });
      records.set(identity, record);
      return record;
    },

    get(key: AgentToolOccurrenceKey): AgentToolOccurrenceRecord | undefined {
      return records.get(encodeOccurrenceKey(key));
    },

    release(key: AgentToolOccurrenceKey): void {
      records.delete(encodeOccurrenceKey(key));
    },

    releaseOwner(ownerId: string): void {
      for (const [identity, record] of records) {
        if (record.key.ownerId === ownerId) {
          records.delete(identity);
        }
      }
    },

    size(): number {
      return records.size;
    },
  });
}

/**
 * Allocate a unique process-local owner execution identity.
 *
 * @remarks Distinct concurrent parent Agent invocations must not share this
 * identity even when they use the same Agent definition id.
 */
export function createOwnerExecutionId(): string {
  nextOwnerExecution += 1;
  return `owner_${Date.now().toString(36)}_${nextOwnerExecution.toString(36)}`;
}

/**
 * Resolve turn/step identity for one Agent-tool occurrence.
 *
 * @remarks Provider/adapter tool retries within the same sealed history share
 * one turn. A later provider step with a longer history is a distinct turn.
 */
export function resolveAgentToolTurnId(execution: {
  readonly messages?: readonly unknown[];
}): string {
  const count = Array.isArray(execution.messages)
    ? execution.messages.length
    : 0;
  return `hist:${count}`;
}

/** Encode the composite occurrence key as a stable map identity. */
export function encodeOccurrenceKey(key: AgentToolOccurrenceKey): string {
  return [
    key.ownerId,
    key.turnId,
    key.toolCallId,
    key.bindingKey,
  ].join("\0");
}

/** Digest normalized assignment input for conflict detection only. */
export function hashOccurrenceInput(input: unknown): string {
  return `sha256:${sha256Hex(
    encoder.encode(canonicalRuntimeJson(toJsonValue(input))),
  )}`;
}

function toJsonValue(input: unknown): JsonValue {
  if (input === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(input)) as JsonValue;
}
