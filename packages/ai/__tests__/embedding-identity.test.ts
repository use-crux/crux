import { describe, expect, it } from "vitest";
import type { EmbeddingModel } from "ai";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

function objectModel(provider: string, modelId: string): EmbeddingModel {
  return {
    specificationVersion: "v3",
    provider,
    modelId,
  } as EmbeddingModel;
}

describe("AI SDK embedding identity", () => {
  const ai = createCruxAi({ gateway: scriptedGateway().gateway });

  function fingerprint(
    model: EmbeddingModel,
    overrides: {
      version?: string;
      batch?: { maxSize?: number; concurrency?: number };
      maxRetries?: number;
      maxParallelCalls?: number;
      headers?: Record<string, string>;
      providerOptions?: Record<string, unknown>;
    } = {},
  ): string | undefined {
    return ai.embedding({
      name: "same-name",
      model,
      dimensions: 2,
      maxInputTokens: 100,
      ...overrides,
    }).fingerprint;
  }

  it("merges model identity with user version without exposing operational request options", () => {
    const stringBase = fingerprint("provider:model-a");
    const objectBase = fingerprint(objectModel("provider-a", "model-a"));

    expect(fingerprint("provider:model-b")).not.toBe(stringBase);
    expect(fingerprint(objectModel("provider-a", "model-b"))).not.toBe(objectBase);
    expect(fingerprint(objectModel("provider-b", "model-a"))).not.toBe(objectBase);
    expect(fingerprint(objectModel("provider-a", "model-a"), { version: "revision-2" })).not.toBe(
      objectBase,
    );
    expect(fingerprint(objectModel("provider-a", "model-b"), { version: "pinned" })).not.toBe(
      fingerprint(objectModel("provider-a", "model-a"), { version: "pinned" }),
    );

    expect(fingerprint(objectModel("provider-a", "model-a"), { batch: { maxSize: 2, concurrency: 2 } })).toBe(
      objectBase,
    );
    const sensitiveOptions = fingerprint(objectModel("provider-a", "model-a"), {
      maxRetries: 4,
      maxParallelCalls: 3,
      headers: { authorization: "secret" },
      providerOptions: { provider: { task: "semantic-search" } },
    });
    expect(sensitiveOptions).toBe(objectBase);
    expect(sensitiveOptions).not.toContain("secret");
    expect(sensitiveOptions).not.toContain("semantic-search");
  });
});
