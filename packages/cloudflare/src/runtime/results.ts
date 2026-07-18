import type { JsonValue } from "@use-crux/core";
import {
  RUNTIME_RESULT_MEDIA_TYPE,
  type RuntimeResultPayloadPort,
  type RuntimeResultRef,
} from "@use-crux/core/runtime";
import {
  canonicalRuntimeResult,
  createRuntimeResultLocation,
} from "@use-crux/core/runtime/internal/eval-host";
import type { CloudflareStoragePort } from "./storage";

const CHUNK_BYTES = 64 * 1024;

interface ResultMetadata {
  readonly namespace: string;
  readonly chunkCount: number;
  readonly createdAt: Date;
  readonly ref: RuntimeResultRef;
}

export function createCloudflareResultPort(
  storage: CloudflareStoragePort,
): RuntimeResultPayloadPort {
  return {
    async put(payload, options): Promise<RuntimeResultRef> {
      const canonical = canonicalRuntimeResult(payload);
      const location = createRuntimeResultLocation(
        "cloudflare-do",
        options.namespace,
        canonical.sha256,
      );
      const metadataKey = `result:${location}`;
      if ((await storage.get<ResultMetadata>(metadataKey)) === undefined) {
        const chunks = chunk(canonical.bytes);
        await Promise.all(
          chunks.map((value, index) =>
            storage.put(`${metadataKey}:chunk:${index}`, value),
          ),
        );
        const ref = {
          sha256: canonical.sha256,
          size: canonical.bytes.byteLength,
          mediaType: RUNTIME_RESULT_MEDIA_TYPE,
          location,
        } satisfies RuntimeResultRef;
        await storage.put(metadataKey, {
          namespace: options.namespace,
          chunkCount: chunks.length,
          createdAt: new Date(),
          ref,
        } satisfies ResultMetadata);
      }
      return {
        sha256: canonical.sha256,
        size: canonical.bytes.byteLength,
        mediaType: RUNTIME_RESULT_MEDIA_TYPE,
        location,
      };
    },
    async get(ref): Promise<JsonValue | null> {
      const metadataKey = `result:${ref.location}`;
      const metadata = await storage.get<ResultMetadata>(metadataKey);
      if (!metadata) return null;
      const chunks = await Promise.all(
        Array.from({ length: metadata.chunkCount }, (_, index) =>
          storage.get<Uint8Array>(`${metadataKey}:chunk:${index}`),
        ),
      );
      if (chunks.some((value) => value === undefined)) {
        throw new TypeError("Runtime result payload is missing a chunk.");
      }
      const bytes = join(chunks as Uint8Array[]);
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as JsonValue;
      const canonical = canonicalRuntimeResult(payload);
      if (
        ref.mediaType !== RUNTIME_RESULT_MEDIA_TYPE ||
        ref.sha256 !== canonical.sha256 ||
        ref.size !== canonical.bytes.byteLength
      ) {
        throw new TypeError(
          "Runtime result payload failed content-integrity verification.",
        );
      }
      return payload;
    },
    async delete(ref) {
      if (!ref.location.endsWith(`:sha256:${ref.sha256}`)) {
        throw new TypeError(
          "Runtime result reference has an invalid Cloudflare location.",
        );
      }
      const metadataKey = `result:${ref.location}`;
      const metadata = await storage.get<ResultMetadata>(metadataKey);
      if (!metadata) return;
      await storage.delete([
        metadataKey,
        ...Array.from(
          { length: metadata.chunkCount },
          (_, index) => `${metadataKey}:chunk:${index}`,
        ),
      ]);
    },
    async pruneUnreferenced(options) {
      const results = await storage.list<unknown>({ prefix: "result:" });
      const work = await storage.list<{ resultRef?: RuntimeResultRef }>({
        prefix: "work:",
      });
      const referenced = new Set(
        [...work.values()]
          .map((item) => item.resultRef?.location)
          .filter((location): location is string => location !== undefined),
      );
      const eligible = [...results.entries()].filter(
        (entry): entry is [string, ResultMetadata] =>
          isResultMetadata(entry[1]) &&
          entry[1].namespace === options.namespace &&
          entry[1].createdAt < options.before &&
          !referenced.has(entry[1].ref.location),
      );
      const selected = eligible.slice(0, options.limit);
      for (const [, metadata] of selected) await this.delete(metadata.ref);
      return {
        removed: selected.length,
        truncated: eligible.length > selected.length,
      };
    },
  };
}

function isResultMetadata(value: unknown): value is ResultMetadata {
  return (
    value !== null &&
    typeof value === "object" &&
    "chunkCount" in value &&
    "namespace" in value &&
    "createdAt" in value &&
    "ref" in value
  );
}

function chunk(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, offset + CHUNK_BYTES));
  }
  return chunks;
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, value) => total + value.byteLength, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const value of chunks) {
    joined.set(value, offset);
    offset += value.byteLength;
  }
  return joined;
}
