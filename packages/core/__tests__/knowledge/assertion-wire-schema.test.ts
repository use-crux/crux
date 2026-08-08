import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ValidationExhaustedError } from "../../src/generation/validation-retry";
import type { CruxChunk, CruxDocument } from "../../src/indexing/types";
import { assertions, type KnowledgeModel } from "../../src/knowledge";
import { runDeriveStages } from "../../src/knowledge/derive/runner";
import { compileAssertionWire } from "../../src/knowledge/derive/assertion-wire";
import { inMemoryRecordStore } from "../../src/storage";

const sourceId = "doc-1";
const types = { fact: z.object({ value: z.string() }) };

describe("generated assertion wire schema", () => {
  it("allocates deterministic grouped slots with a closed portable schema", () => {
    const compiled = compileAssertionWire({
      zebra: z.object({ count: z.number().int(), state: z.enum(["open", "closed"]).describe("Lifecycle state") }).strict(),
      alpha: z.object({ enabled: z.boolean() }).strict().describe("Alpha guidance"),
    });
    const json = z.toJSONSchema(compiled.schema) as Record<string, unknown>;

    expect(compiled.manifest.slots.map(({ slot, type, mode }) => ({ slot, type, mode }))).toEqual([
      { slot: "type_0", type: "alpha", mode: "typed" },
      { slot: "type_1", type: "zebra", mode: "typed" },
    ]);
    expect(Object.keys(json.properties as object)).toEqual(["type_0", "type_1"]);
    expect(json.required).toEqual(["type_0", "type_1"]);
    expect(json.additionalProperties).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/oneOf|anyOf|allOf|nullable/);
    expect(JSON.stringify(json)).toContain("Alpha guidance");
    expect(JSON.stringify(json)).toContain("Lifecycle state");
  });

  it("falls back unsupported kinds without degrading portable neighbors", () => {
    const compiled = compileAssertionWire({
      portable: z.object({ value: z.string() }).strict(),
      union: z.union([z.string(), z.number()]).describe("String or numeric identifier"),
    });

    expect(compiled.manifest.slots.map(({ type, mode, fallbackReason }) => ({ type, mode, fallbackReason }))).toEqual([
      { type: "portable", mode: "typed", fallbackReason: undefined },
      { type: "union", mode: "json-string", fallbackReason: "unsupported keyword anyOf" },
    ]);
    const json = JSON.stringify(z.toJSONSchema(compiled.schema));
    expect(json).toContain("dataJson");
    expect(json).toContain("String or numeric identifier");
    expect(json).not.toContain("anyOf");
  });

  it("uses JSON strings for unconstrained, transformed, and unapproved schemas", () => {
    const compiled = compileAssertionWire({
      any: z.any(),
      unknown: z.unknown(),
      transformed: z.string().transform((value) => value.trim()),
      formatted: z.string().email(),
      empty: z.object({}).strict(),
      loose: z.object({ value: z.string() }).loose(),
      optional: z.object({ value: z.string().optional() }),
      union: z.union([z.string(), z.number()]),
      date: z.date(),
      array: z.array(z.string()),
      boolean: z.boolean(),
      enum: z.enum(["open", "closed"]),
      number: z.number(),
      portable: z.object({ value: z.string() }).strict(),
      string: z.string(),
    });

    expect(compiled.manifest.slots.map(({ type, mode }) => ({ type, mode }))).toEqual([
      { type: "any", mode: "json-string" },
      { type: "array", mode: "typed" },
      { type: "boolean", mode: "typed" },
      { type: "date", mode: "json-string" },
      { type: "empty", mode: "json-string" },
      { type: "enum", mode: "typed" },
      { type: "formatted", mode: "json-string" },
      { type: "loose", mode: "json-string" },
      { type: "number", mode: "typed" },
      { type: "optional", mode: "json-string" },
      { type: "portable", mode: "typed" },
      { type: "string", mode: "typed" },
      { type: "transformed", mode: "json-string" },
      { type: "union", mode: "json-string" },
      { type: "unknown", mode: "json-string" },
    ]);
  });

  it("decodes typed and JSON-string slots together", async () => {
    const model = fixedModel([{
      type_0: [{ dataJson: '{"value":"fallback"}', evidence: ["e0"], provenance: "exact" }],
      type_1: [{ data: { value: "typed" }, evidence: ["e0"], provenance: "exact" }],
    }]);
    const stage = assertions({
      id: "facts", version: 1, model,
      types: { fallback: z.union([z.object({ value: z.string() }), z.string()]), portable: z.object({ value: z.string() }) },
    });

    await expect(runDeriveStages({ records: inMemoryRecordStore(), indexerId: "kb", namespace: "wire-schema", stages: [stage], document: document(), chunks: [chunk("target", 0)] }))
      .resolves.toMatchObject([{ status: "ran", claims: 2 }]);
  });

  it("repairs only invalid slots and preserves claims from retained slots", async () => {
    const prompts: string[] = [];
    const model = fixedModel([
      {
        type_0: [{ data: { value: "keep" }, evidence: ["e0"], provenance: "exact" }],
        type_1: [{ data: { count: "bad" }, evidence: ["e0"], provenance: "exact" }],
      },
      {
        type_0: [],
        type_1: [{ data: { count: 2 }, evidence: ["e0"], provenance: "exact" }],
      },
    ], prompts);
    const stage = assertions({ id: "facts", version: 1, model, types: {
      alpha: z.object({ value: z.string() }), beta: z.object({ count: z.number() }),
    } });

    await expect(runDeriveStages({ records: inMemoryRecordStore(), indexerId: "kb", namespace: "wire-schema", stages: [stage], document: document(), chunks: [chunk("target", 0)] }))
      .resolves.toMatchObject([{ status: "ran", claims: 2 }]);
    expect(prompts[1]).toContain("Repair only these invalid slots: type_1");
    expect(prompts[1]).toContain("Return [] for every retained slot");
  });

  it("repairs malformed JSON and unknown slots locally", async () => {
    const prompts: string[] = [];
    const model = fixedModel([
      { type_0: [{ dataJson: "{bad", evidence: ["e0"], provenance: "exact" }], unexpected: [] },
      { type_0: [{ dataJson: '{"value":"fixed"}', evidence: ["e0"], provenance: "exact" }] },
    ], prompts);
    const stage = assertions({ id: "facts", version: 1, model, types: { fact: z.union([z.object({ value: z.string() }), z.string()]) } });

    await expect(runDeriveStages({ records: inMemoryRecordStore(), indexerId: "kb", namespace: "wire-schema", stages: [stage], document: document(), chunks: [chunk("target", 0)] }))
      .resolves.toMatchObject([{ status: "ran", claims: 1 }]);
    expect(prompts[1]).toContain("type_0[0]: malformed dataJson");
    expect(prompts[1]).toContain("unexpected: unknown assertion slot");
  });

  it("closes evidence over deterministic batch-local labels", async () => {
    const schema = z.toJSONSchema(await captureSchema(chunks(2)));
    const serialized = JSON.stringify(schema);

    expect(serialized).toContain('"enum":["e0","e1"]');
    expect(serialized).not.toContain("chunk-0");
    expect(serialized).not.toContain("chunk-1");
  });

  it("requires every wire object property, including provenance", async () => {
    const schema = z.toJSONSchema(await captureSchema(chunks(2)));
    const provenance = findPropertySchema(schema, "provenance");

    expect(allPropertiesRequired(schema)).toBe(true);
    expect(provenance).toMatchObject({ enum: ["exact", "derived"] });
    expect(objectContainingProperty(schema, "provenance")).toSatisfy(
      (node: unknown) => {
        if (!isRecord(node) || !Array.isArray(node.required)) return false;
        return node.required.includes("provenance");
      },
    );
  });

  it.each([
    ["fabricated", "missing", "unknown or context-only evidence label"],
    ["context-only", "c0", "unknown or context-only evidence label"],
  ] as const)(
    "repairs then rejects %s evidence locally",
    async (_name, chunkId, message) => {
      const prompts: string[] = [];
      const model = fixedModel(
        [generatedClaim(chunkId), generatedClaim(chunkId)],
        prompts,
      );
      const stage = assertions({
        id: "facts",
        version: 1,
        types,
        model,
        targets: (visible) =>
          visible.filter((chunk) => chunk.chunkId === "target"),
      });

      const error = await runDeriveStages({
        records: inMemoryRecordStore(),
        indexerId: "kb",
        namespace: "wire-schema",
        stages: [stage],
        document: document(),
        chunks: [chunk("target", 0), chunk("context", 1)],
      }).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ValidationExhaustedError);
      expect(model.generateObject).toHaveBeenCalledTimes(2);
      expect(prompts[1]).toContain(message);
      expect((error as ValidationExhaustedError).issues).toEqual([
        { path: "type_0", depth: 1, code: "custom" },
      ]);
    },
  );

  it("accepts valid generic evidence with one generation call", async () => {
    const model = fixedModel([generatedClaim("e0")]);
    const stage = assertions({ id: "facts", version: 1, types, model });

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: "kb",
      namespace: "wire-schema",
      stages: [stage],
      document: document(),
      chunks: [chunk("target", 0)],
    });

    expect(result[0]).toMatchObject({ status: "ran", claims: 1 });
    expect(model.generateObject).toHaveBeenCalledTimes(1);
  });
});

async function captureSchema(
  sourceChunks: readonly CruxChunk[],
): Promise<z.ZodType<unknown>> {
  let captured: z.ZodType<unknown> | undefined;
  const model: KnowledgeModel = {
    name: "wire-schema",
    fingerprint: "wire-schema-v1",
    generateText: async () =>
      ({ text: "", usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async ({ schema }) => {
      captured = schema;
      return { object: { type_0: [] } };
    }),
  };
  const stage = assertions({ id: "facts", version: 1, types, model });
  await runDeriveStages({
    records: inMemoryRecordStore(),
    indexerId: "kb",
    namespace: "wire-schema",
    stages: [stage],
    document: document(),
    chunks: sourceChunks,
  });
  if (!captured) throw new Error("Expected generated assertion schema.");
  return captured;
}

function fixedModel(
  objects: readonly unknown[],
  prompts: string[] = [],
): KnowledgeModel {
  let index = 0;
  return {
    name: "wire-schema",
    fingerprint: "wire-schema-v1",
    generateText: async () =>
      ({ text: "", usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async ({ prompt }) => {
      prompts.push(prompt);
      return { object: objects[index++] ?? objects[objects.length - 1] };
    }),
  };
}

function generatedClaim(evidenceLabel: string) {
  return {
    type_0: [
      {
        data: { value: "fact" },
        evidence: [evidenceLabel],
        provenance: "derived" as const,
      },
    ],
  };
}

function document(): CruxDocument {
  return {
    namespace: "wire-schema",
    sourceId,
    content: "Document.",
    metadata: {},
  };
}

function chunks(count: number): readonly CruxChunk[] {
  return Array.from({ length: count }, (_, index) =>
    chunk(`chunk-${index}`, index),
  );
}

function chunk(chunkId: string, ordinal: number): CruxChunk {
  return {
    namespace: "wire-schema",
    sourceId,
    chunkId,
    ordinal,
    content: chunkId,
    metadata: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allPropertiesRequired(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(allPropertiesRequired);
  if (!isRecord(value)) return true;
  const properties = value.properties;
  if (isRecord(properties)) {
    if (
      !Array.isArray(value.required) ||
      propertiesKeys(properties).some((key) => !value.required.includes(key))
    )
      return false;
  }
  return Object.values(value).every(allPropertiesRequired);
}

function findPropertySchema(value: unknown, name: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPropertySchema(item, name);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const properties = value.properties;
  if (isRecord(properties) && properties[name] !== undefined)
    return properties[name];
  for (const item of Object.values(value)) {
    const found = findPropertySchema(item, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function objectContainingProperty(value: unknown, name: string): unknown {
  if (Array.isArray(value))
    return value.find(
      (item) => objectContainingProperty(item, name) !== undefined,
    );
  if (!isRecord(value)) return undefined;
  if (isRecord(value.properties) && value.properties[name] !== undefined)
    return value;
  for (const item of Object.values(value)) {
    const found = objectContainingProperty(item, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function propertiesKeys(value: Record<string, unknown>): readonly string[] {
  return Object.keys(value);
}
