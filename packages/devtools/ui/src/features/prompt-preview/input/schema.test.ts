import { describe, expect, it } from "vitest";

import { promptPreviewFormSchema } from "./schema";

describe("Prompt preview safe form schema", () => {
  it("accepts the complete closed object/scalar/array subset", () => {
    const schema = {
      type: "object",
      title: "Request",
      description: "Exact input",
      additionalProperties: false,
      required: ["name", "count"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 50,
          default: "Ada",
        },
        count: { type: "integer", minimum: 1, maximum: 5 },
        active: { type: ["boolean", "null"], enum: [true, false, null] },
        tags: {
          type: "array",
          minItems: 0,
          maxItems: 10,
          items: { type: "string" },
        },
        nested: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: { score: { type: "number" } },
        },
      },
    };
    expect(promptPreviewFormSchema(schema)).toEqual(schema);
  });

  it.each([
    ["references", { $ref: "#/$defs/X" }],
    ["open objects", { type: "object", properties: {} }],
    [
      "schema-valued additional properties",
      { type: "object", properties: {}, additionalProperties: {} },
    ],
    ["composition", { oneOf: [{ type: "string" }] }],
    ["tuple arrays", { type: "array", items: [{ type: "string" }] }],
    ["format", { type: "string", format: "email" }],
    ["pattern", { type: "string", pattern: "x" }],
    [
      "large enum",
      { type: "string", enum: Array.from({ length: 101 }, (_, i) => `${i}`) },
    ],
    [
      "large array",
      { type: "array", maxItems: 101, items: { type: "string" } },
    ],
    ["foreign keyword", { type: "boolean", readOnly: true }],
  ])("rejects the entire form for %s", (_name, property) => {
    expect(
      promptPreviewFormSchema({
        type: "object",
        properties: { value: property },
        additionalProperties: false,
      }),
    ).toBeUndefined();
  });

  it("rejects duplicate/missing required names and depth/control overflow", () => {
    expect(
      promptPreviewFormSchema({
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value", "value"],
        additionalProperties: false,
      }),
    ).toBeUndefined();
    expect(
      promptPreviewFormSchema({
        type: "object",
        properties: {},
        required: ["missing"],
        additionalProperties: false,
      }),
    ).toBeUndefined();

    let nested: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 9; index += 1) {
      nested = {
        type: "object",
        properties: { nested },
        additionalProperties: false,
      };
    }
    expect(promptPreviewFormSchema(nested)).toBeUndefined();

    const properties = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [
        `field${index}`,
        { type: "string" },
      ]),
    );
    expect(
      promptPreviewFormSchema({
        type: "object",
        properties,
        additionalProperties: false,
      }),
    ).toBeUndefined();
  });

  it("accepts null only when the scalar type is explicitly nullable", () => {
    const root = (property: unknown) => ({
      type: "object",
      properties: { value: property },
      additionalProperties: false,
    });
    expect(
      promptPreviewFormSchema(
        root({ type: ["string", "null"], default: null }),
      ),
    ).toBeDefined();
    expect(
      promptPreviewFormSchema(root({ type: "string", default: null })),
    ).toBeUndefined();
    expect(
      promptPreviewFormSchema(root({ type: "boolean", enum: [true, null] })),
    ).toBeUndefined();
  });
});
