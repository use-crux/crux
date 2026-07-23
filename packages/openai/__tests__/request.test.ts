import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compileStructuredOutput } from "@use-crux/core/adapter";
import {
  openAIRequest,
  openAISettings,
  openAIStructuredCapabilities,
} from "../src/request";

describe("OpenAI request settings", () => {
  it("maps portable reasoning effort to OpenAI reasoning_effort", () => {
    expect(openAISettings({ reasoning: "high" })).toMatchObject({
      reasoning_effort: "high",
    });
    expect(openAISettings({ reasoning: "high" })).not.toHaveProperty(
      "reasoning",
    );
  });
});

describe("OpenAI structured-output request", () => {
  const baseArgs = {
    model: "gpt-4o",
    system: undefined,
    systemBlocks: undefined,
    messages: [],
    providerMessages: [],
    settings: {},
    schema: undefined,
    tools: undefined,
    extra: {},
  };

  it("places the core-compiled strict schema in response_format", () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
      bio: z.string().nullable(),
    });
    const outputSchema = compileStructuredOutput(
      schema,
      openAIStructuredCapabilities,
    ).outputSchema;

    const request = openAIRequest({ ...baseArgs, schema, outputSchema });
    const jsonSchema = (
      request.response_format as {
        json_schema: { strict: boolean; schema: Record<string, unknown> };
      }
    ).json_schema;

    expect(jsonSchema.strict).toBe(true);
    // Strict mode: every property required, extra properties forbidden.
    expect(jsonSchema.schema.required).toEqual(["name", "nickname", "bio"]);
    expect(jsonSchema.schema.additionalProperties).toBe(false);
    // Optional-only `nickname` is lowered to a null union; genuine nullable stays.
    const properties = jsonSchema.schema.properties as Record<
      string,
      { anyOf?: Array<{ type?: string }> }
    >;
    expect(properties.nickname.anyOf?.some((e) => e.type === "null")).toBe(true);
    expect(properties.bio.anyOf?.some((e) => e.type === "null")).toBe(true);
  });

  it("omits response_format for a non-structured request", () => {
    const request = openAIRequest({ ...baseArgs, outputSchema: undefined });
    expect(request).not.toHaveProperty("response_format");
  });
});
