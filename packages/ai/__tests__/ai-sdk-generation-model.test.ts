import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import type { AgentExecutor } from "@use-crux/core/agent";
import { router } from "@use-crux/core/routing";
import { aiSdk } from "../src";

function nativeModel(provider: string, modelId: string): LanguageModel {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

function runtimePort(bound: object): {
  createAgentExecutor: () => AgentExecutor;
} {
  const symbols = Object.getOwnPropertySymbols(bound);
  expect(symbols.length).toBeGreaterThan(0);
  const port = (bound as Record<symbol, unknown>)[symbols[0]!];
  expect(port).toEqual(
    expect.objectContaining({
      createAgentExecutor: expect.any(Function),
    }),
  );
  return port as { createAgentExecutor: () => AgentExecutor };
}

describe("aiSdk GenerationModel binding", () => {
  it("returns a frozen bound model with secret-free identity and opaque executor authority", () => {
    const native = nativeModel("test", "nebula-text-v2");
    const bound = aiSdk(native);

    expect(Object.isFrozen(bound)).toBe(true);
    expect(bound._tag).toBe("crux.generation-model");
    expect(bound.native).toBe(native);
    expect(bound.adapter).toEqual({ id: "ai-sdk", version: "1" });
    expect(bound.definition.id).toMatch(/^ai-sdk:/);
    expect(bound.definition.id).not.toMatch(/secret|api[_-]?key|token/i);
    expect(bound.definition.fingerprint.length).toBeGreaterThan(0);
    expect(bound.definition.fingerprint).not.toMatch(
      /secret|api[_-]?key|token/i,
    );
    expect(bound.identity).toEqual({
      kind: "model",
      model: "test:nebula-text-v2",
    });
    expect(bound.capabilities).toEqual({
      contract: "crux.generation-capabilities.v1",
      language: expect.arrayContaining(["text-input", "text-output"]),
      image: [],
      speech: [],
      transcription: [],
      embedding: [],
    });
    expect(Object.isFrozen(bound.capabilities)).toBe(true);
    expect(Object.isFrozen(bound.capabilities.image)).toBe(true);

    const executor = runtimePort(bound).createAgentExecutor();
    expect(typeof executor).toBe("function");
  });

  it("binds a same-adapter router with secret-free route identity", () => {
    const fast = nativeModel("test", "fast");
    const deep = nativeModel("test", "deep");
    const routed = router({
      id: "quality-route",
      classify: () => "fast" as const,
      routes: { fast, deep, default: fast },
    });
    const bound = aiSdk(routed);

    expect(Object.isFrozen(bound)).toBe(true);
    expect(bound._tag).toBe("crux.generation-model");
    expect(bound.native).toBe(routed);
    expect(bound.identity).toEqual({
      kind: "router",
      router: "quality-route",
      routes: [
        { key: "deep", target: "test:deep" },
        { key: "default", target: "test:fast" },
        { key: "fast", target: "test:fast" },
      ],
    });
    expect(bound.definition.id).toContain("quality-route");
    expect(bound.capabilities.image).toEqual([]);
    expect(typeof runtimePort(bound).createAgentExecutor()).toBe("function");
  });
});
