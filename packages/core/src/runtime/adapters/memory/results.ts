import type { JsonValue } from "../../../storage";
import { canonicalRuntimeResult } from "../../results/canonical";
import {
  RUNTIME_RESULT_MEDIA_TYPE,
  type RuntimeResultPayloadPort,
  type RuntimeResultRef,
} from "../../results/types";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { sha256Hex } from "../../../content/sha256";

/** Create the canonical content-addressed result port for the memory adapter. */
export function createMemoryResultPayloadPort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeResultPayloadPort {
  return {
    async put(payload, options): Promise<RuntimeResultRef> {
      const canonical = canonicalRuntimeResult(payload);
      const namespaceHash = sha256Hex(
        new TextEncoder().encode(options.namespace),
      );
      const location = `memory:${namespaceHash}:sha256:${canonical.sha256}`;
      if (!data.results.has(location)) {
        recordWrite?.();
        data.results.set(location, {
          namespace: options.namespace,
          json: canonical.json,
          createdAt: new Date(),
        });
      }
      return Object.freeze({
        sha256: canonical.sha256,
        size: canonical.bytes.byteLength,
        mediaType: RUNTIME_RESULT_MEDIA_TYPE,
        location,
      });
    },
    async get(ref): Promise<JsonValue | null> {
      const stored = data.results.get(ref.location);
      if (stored === undefined) return null;
      const canonical = canonicalRuntimeResult(
        JSON.parse(stored.json) as JsonValue,
      );
      if (
        ref.mediaType !== RUNTIME_RESULT_MEDIA_TYPE ||
        ref.sha256 !== canonical.sha256 ||
        ref.size !== canonical.bytes.byteLength
      ) {
        throw new TypeError(
          "Runtime result payload failed content-integrity verification.",
        );
      }
      return JSON.parse(canonical.json) as JsonValue;
    },
    async delete(ref): Promise<void> {
      if (!ref.location.endsWith(`:sha256:${ref.sha256}`)) {
        throw new TypeError(
          "Runtime result reference has an invalid memory location.",
        );
      }
      if (data.results.delete(ref.location)) recordWrite?.();
    },
    async pruneUnreferenced(options) {
      const referenced = new Set(
        [
          ...[...data.work.values()].map((work) => work.resultRef?.location),
          ...[...data.sessionInputs.values()].map(
            (input) => input.preparedExecution?.preparedResultRef.location,
          ),
        ]
          .filter((location): location is string => location !== undefined),
      );
      const eligible = [...data.results.entries()].filter(
        ([location, result]) =>
          result.namespace === options.namespace &&
          result.createdAt.getTime() < options.before.getTime() &&
          !referenced.has(location),
      );
      for (const [location] of eligible.slice(0, options.limit)) {
        data.results.delete(location);
        recordWrite?.();
      }
      return {
        removed: Math.min(eligible.length, options.limit),
        truncated: eligible.length > options.limit,
      };
    },
  };
}
