import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InterceptedGeneration } from "../../src/adapter/interception";
import {
  buildNormalizedCall,
  normalizedCallKey,
} from "../../src/quality/internal/cassette";
import {
  CASSETTE_CACHE_EPOCH,
  OUTPUT_CACHE_EPOCH,
  fingerprintValue,
} from "../../src/quality/internal/cache-identity";
import {
  cellCacheKey,
  readCellCache,
  writeCellCache,
} from "../../src/quality/internal/output-cache";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  ),
);

function mediaCall(byte: number): InterceptedGeneration {
  return {
    kind: "structured",
    promptId: "media-judge",
    modelInfo: { provider: "fake", modelId: "vision" },
    system: undefined,
    prompt: undefined,
    settings: {},
    outputSchema: undefined,
    tools: undefined,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "data",
              data: new Uint8Array([byte]),
              mediaType: "image/png",
            },
          },
        ],
      },
    ],
  };
}

describe("Quality media cache identity", () => {
  it("bumps stale epochs and fingerprints bytes without retaining them", () => {
    expect(CASSETTE_CACHE_EPOCH).toBe(3);
    expect(OUTPUT_CACHE_EPOCH).toBe(3);
    expect(normalizedCallKey(mediaCall(1))).not.toBe(
      normalizedCallKey(mediaCall(2)),
    );
    const normalized = JSON.stringify(buildNormalizedCall(mediaCall(123)));
    expect(normalized).not.toContain("123");
    expect(normalized).not.toContain("image/png");
  });

  it("does not implicitly write binary task output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crux-media-cache-"));
    dirs.push(dir);
    const key = cellCacheKey({
      evaluationId: "media",
      caseKey: "case",
      variantName: "default",
      trial: 0,
      taskFingerprint: "task",
      paramsFingerprint: "params",
    });
    await writeCellCache(dir, "media", key, {
      output: { type: "data", data: new Uint8Array([1, 2, 3]) },
      signals: { captured: [] },
      durationMs: 1,
      traceIds: [],
      cachedAt: new Date(0).toISOString(),
    });
    await expect(readCellCache(dir, "media", key)).resolves.toBeUndefined();
  });

  it("never reuses unknowable Blob identity across calls or simulated restarts", () => {
    const blob = new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" });
    const first = fingerprintValue({ blob });
    const sameObjectAgain = fingerprintValue({ blob });
    const simulatedRestart = fingerprintValue({
      blob: new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" }),
    });
    expect(sameObjectAgain).not.toBe(first);
    expect(simulatedRestart).not.toBe(first);
  });
});
