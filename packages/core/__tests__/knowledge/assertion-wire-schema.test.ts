import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ValidationExhaustedError } from "../../src/generation/validation-retry";
import type { CruxChunk, CruxDocument } from "../../src/indexing/types";
import { assertions, type KnowledgeModel } from "../../src/knowledge";
import { runDeriveStages } from "../../src/knowledge/derive/runner";
import { inMemoryRecordStore } from "../../src/storage";

const sourceId = "doc-1";
const types = { fact: z.object({ value: z.string() }) };

describe("generated assertion wire schema", () => {
  it("is constant in chunk count and uses generic evidence references", async () => {
    const small = await captureSchema(chunks(2));
    const large = await captureSchema(chunks(40));
    const smallJson = z.toJSONSchema(small);
    const largeJson = z.toJSONSchema(large);
    const serialized = JSON.stringify(smallJson);

    expect(serialized.length).toBe(JSON.stringify(largeJson).length);
    expect(serialized).not.toContain("chunk-7");
    expect(hasPlainStringEvidenceRefs(smallJson)).toBe(true);
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
    ["fabricated", "missing", "invalid evidence"],
    ["context-only", "context", "invalid evidence — context-only chunk"],
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
        { path: "assertions.[0].evidence", depth: 3, code: "custom" },
      ]);
    },
  );

  it("accepts valid generic evidence with one generation call", async () => {
    const model = fixedModel([generatedClaim("target")]);
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
      return { object: { assertions: [] } };
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

function generatedClaim(chunkId: string) {
  return {
    assertions: [
      {
        type: "fact",
        data: { value: "fact" },
        evidence: [{ kind: "chunk" as const, sourceId, chunkId }],
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

function hasPlainStringEvidenceRefs(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPlainStringEvidenceRefs);
  if (!isRecord(value)) return false;
  const properties = value.properties;
  if (
    isRecord(properties) &&
    isRecord(properties.sourceId) &&
    isRecord(properties.chunkId)
  ) {
    return (
      properties.sourceId.type === "string" &&
      properties.chunkId.type === "string"
    );
  }
  return Object.values(value).some(hasPlainStringEvidenceRefs);
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
