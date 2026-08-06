import { describe, expect, it } from "vitest";
import { agent } from "../../src/agent";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { prompt } from "../../src";
import {
  GenerationModelBindingError,
  GenerationModelCapabilityError,
} from "../../src/session/errors";
import { requireCompatibleModel } from "../../src/session/model-guard";
import { z } from "zod";

const support = agent({
  id: "model-guard-support",
  prompt: prompt({
    id: "model-guard-prompt",
    input: z.object({ message: z.string() }),
    output: z.object({ reply: z.string() }),
    system: "Reply helpfully.",
  }),
  model: defineGenerationModel({
    adapter: { id: "test", version: "1" },
    native: Object.freeze({ id: "ok" }),
    definition: { id: "test:ok", fingerprint: "v1" },
    identity: { kind: "model", model: "ok" },
    capabilities: {
      contract: "crux.generation-capabilities.v1",
      language: ["text-input", "text-output", "structured-output"],
      embedding: [],
      image: [],
      speech: [],
      transcription: [],
    },
    runtime: { createAgentExecutor: () => async () => ({}) },
  }),
});

describe("requireCompatibleModel", () => {
  it("accepts a valid tagged GenerationModel with required capabilities", () => {
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "valid" }),
      definition: { id: "test:valid", fingerprint: "v1" },
      identity: { kind: "model", model: "valid" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output", "structured-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: { createAgentExecutor: () => async () => ({}) },
    });
    expect(requireCompatibleModel(support, model)).toBe(model);
  });

  it("rejects missing models with GenerationModelBindingError", () => {
    expect(() => requireCompatibleModel(support, undefined)).toThrow(
      GenerationModelBindingError,
    );
    expect(() => requireCompatibleModel(support, null)).toThrow(
      GenerationModelBindingError,
    );
    expect(() => requireCompatibleModel(support, { id: "nope" })).toThrow(
      GenerationModelBindingError,
    );
  });

  it("rejects malformed tagged capability shapes without TypeError", () => {
    const cases = [
      { _tag: "crux.generation-model" },
      { _tag: "crux.generation-model", capabilities: null },
      { _tag: "crux.generation-model", capabilities: "bad" },
      { _tag: "crux.generation-model", capabilities: {} },
      {
        _tag: "crux.generation-model",
        capabilities: { language: "text-input" },
      },
    ] as const;
    for (const value of cases) {
      try {
        requireCompatibleModel(support, value);
        expect.unreachable("expected GenerationModelBindingError");
      } catch (error) {
        expect(error).toBeInstanceOf(GenerationModelBindingError);
        expect(error).not.toBeInstanceOf(TypeError);
      }
    }
  });

  it("rejects valid tags missing required language capabilities", () => {
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "text-only" }),
      definition: { id: "test:text-only", fingerprint: "v1" },
      identity: { kind: "model", model: "text-only" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: { createAgentExecutor: () => async () => ({}) },
    });
    expect(() => requireCompatibleModel(support, model)).toThrow(
      GenerationModelCapabilityError,
    );
  });
});
