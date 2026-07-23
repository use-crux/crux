/**
 * AI SDK OpenAI strict structured lowering.
 *
 * `@ai-sdk/openai` forwards the compiled response schema to OpenAI unchanged with
 * `strict: true`, so core owns the strict lowering: every property required,
 * optional-only properties encoded as required+nullable, `additionalProperties:
 * false`, and a reversible sentinel-delete manifest. The manifest must be applied
 * before Safety observes the object, so a completed-output guardrail sees the
 * omitted optional as absent — not as a null sentinel.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { compileStructuredOutput } from "@use-crux/core/adapter";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createCruxAi } from "../src";
import { aiSdkStructuredCapabilities } from "../src/provider-profile";
import { structuredModel } from "./mock-model";

describe("AI SDK OpenAI strict structured lowering", () => {
  it("lowers an optional property to required+nullable with additionalProperties:false", () => {
    const capabilities = aiSdkStructuredCapabilities({
      provider: "openai",
      modelId: "gpt-4o",
    });
    expect(capabilities?.id).toBe("ai-sdk.openai");
    const plan = compileStructuredOutput(
      z.object({ name: z.string(), note: z.string().optional() }),
      capabilities!,
    );
    expect(plan.outputSchema.required).toEqual(["name", "note"]);
    expect(plan.outputSchema.additionalProperties).toBe(false);
    expect(plan.decodeManifest.operations).toEqual([
      { kind: "delete-null-sentinel", path: ["note"] },
    ]);
  });

  it("deletes the null sentinel before Safety observes the completed object", async () => {
    let observed: unknown;
    const structured = prompt({
      id: "strict-optional",
      prompt: "return json",
      output: z.object({ name: z.string(), note: z.string().optional() }),
    });

    const result = await createCruxAi().generate(structured, {
      // The strict wire schema makes `note` required+nullable, so the model
      // returns the null sentinel for the omitted optional.
      model: structuredModel(['{"name":"x","note":null}']),
      guardrails: [
        guardrail({
          id: "observe-structured-object",
          on: boundary.output.object<{ name: string; note?: string }>(),
          run: (object) => {
            observed = object;
            return { action: "allow" };
          },
        }),
      ],
    });

    // Decode ran before Safety: the sentinel is gone, the optional is absent.
    expect(observed).toEqual({ name: "x" });
    expect(result.object).toEqual({ name: "x" });
  });
});
