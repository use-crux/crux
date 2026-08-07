/**
 * Unknown AI SDK models fail before transport for schema'd tools.
 *
 * The AI SDK capability resolver returns `undefined` when a model's structured
 * output semantics cannot be verified. A tool that declares an input schema
 * (Zod or raw JSON Schema) must then fail before any provider I/O rather than
 * silently compiling against a permissive default. Schemaless tools are
 * unaffected.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { prompt } from "@use-crux/core";
import { CruxUnsupportedStructuredOutputError } from "@use-crux/core/adapter";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

const unknownModel = {
  provider: "cohere",
  modelId: "command",
  specificationVersion: "v3",
} as unknown as LanguageModel;

const toolPrompt = prompt({
  id: "unknown-model-tools",
  prompt: "Use a tool.",
});

describe("unknown AI SDK model tool schemas", () => {
  it("passes a Zod tool schema through by default", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "unused" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await ai.generate(toolPrompt, {
      model: unknownModel,
      tools: {
        save: {
          description: "save",
          inputSchema: z.object({ q: z.string() }),
          execute: async () => "ok",
        },
      } as never,
    });
    expect(scripted.calls.generateText).toHaveLength(1);
  });

  it("rejects a raw JSON Schema tool without calling the provider", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "unused" }] });
    const ai = createCruxAi({
      gateway: scripted.gateway,
      structuredOutput: { unknownModel: "reject" },
    });

    await expect(
      ai.generate(toolPrompt, {
        model: unknownModel,
        tools: {
          save: {
            description: "save",
            inputSchema: {
              type: "object",
              properties: { q: { type: "string" } },
            },
            execute: async () => "ok",
          },
        } as never,
      }),
    ).rejects.toBeInstanceOf(CruxUnsupportedStructuredOutputError);
    expect(scripted.calls.generateText).toHaveLength(0);
  });

  it("allows a schemaless tool on an unknown model", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(toolPrompt, {
      model: unknownModel,
      tools: {
        ping: { description: "ping", execute: async () => "pong" },
      } as never,
    });

    expect(result.text).toBe("done");
    expect(scripted.calls.generateText).toHaveLength(1);
  });
});
