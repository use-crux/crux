/**
 * Optional-to-nullable lowering contract.
 *
 * Under a profile that requires all properties, an authored optional-only
 * property is emitted as required, its wire schema also accepts a null sentinel,
 * and a `delete-null-sentinel` manifest operation is recorded for that
 * occurrence. Genuine nullable and nullish properties keep their null and never
 * gain a delete operation. A permissive profile lowers nothing.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CruxUnsupportedSchemaError,
  compileStructuredOutput,
} from "../../../src/adapter/structured-output";
import {
  genuineNullableSchema,
  nestedOptionalObjectSchema,
  nullishSchema,
  optionalArrayElementSchema,
  optionalOnlySchema,
  requiredPrimitiveSchema,
} from "./normalization-fixtures";
import {
  permissiveCapabilities,
  strictCapabilities,
} from "./capability-fixtures";

function props(schema: Record<string, unknown>): Record<string, unknown> {
  return schema.properties as Record<string, unknown>;
}

function isNullable(node: unknown): boolean {
  const record = node as { anyOf?: Array<{ type?: string }> };
  return (
    Array.isArray(record.anyOf) &&
    record.anyOf.some((entry) => entry?.type === "null")
  );
}

const deletePaths = (
  plan: ReturnType<typeof compileStructuredOutput>,
): unknown[][] =>
  plan.decodeManifest.operations.map((op) => [...op.path]);

describe("optional lowering — strict profile", () => {
  it("emits an optional-only property as required + nullable with a delete op", () => {
    const plan = compileStructuredOutput(optionalOnlySchema, strictCapabilities);
    expect(plan.outputSchema.required).toEqual(["name"]);
    expect(isNullable(props(plan.outputSchema).name)).toBe(true);
    expect(deletePaths(plan)).toEqual([["name"]]);
    expect(plan.diagnostics.map((d) => d.code)).toContain(
      "lowered-optional-to-nullable",
    );
  });

  it("keeps a genuine nullable required with no delete op", () => {
    const plan = compileStructuredOutput(
      genuineNullableSchema,
      strictCapabilities,
    );
    expect(plan.outputSchema.required).toEqual(["name"]);
    expect(isNullable(props(plan.outputSchema).name)).toBe(true);
    expect(plan.decodeManifest.operations).toEqual([]);
  });

  it("makes a nullish property required + nullable with no delete op", () => {
    const plan = compileStructuredOutput(nullishSchema, strictCapabilities);
    expect(plan.outputSchema.required).toEqual(["name"]);
    expect(isNullable(props(plan.outputSchema).name)).toBe(true);
    expect(plan.decodeManifest.operations).toEqual([]);
  });

  it("recurses into nested optional objects with a manifest op per occurrence", () => {
    const plan = compileStructuredOutput(
      nestedOptionalObjectSchema,
      strictCapabilities,
    );
    expect(deletePaths(plan)).toEqual([["user"], ["user", "email"]]);
    expect(plan.outputSchema.required).toEqual(["user"]);
  });

  it("uses a wildcard path for optional array element fields", () => {
    const plan = compileStructuredOutput(
      optionalArrayElementSchema,
      strictCapabilities,
    );
    expect(deletePaths(plan)).toEqual([["items", "*", "tag"]]);
  });

  it("leaves a required primitive unchanged with an empty manifest", () => {
    const plan = compileStructuredOutput(
      requiredPrimitiveSchema,
      strictCapabilities,
    );
    expect(plan.outputSchema.required).toEqual(["name"]);
    expect(plan.decodeManifest.operations).toEqual([]);
  });

  it("lowers inlined reused shapes deterministically", () => {
    const inner = z.object({ v: z.string().optional() });
    const schema = z.object({ a: inner, b: inner });
    const plan = compileStructuredOutput(schema, strictCapabilities);
    expect(deletePaths(plan)).toEqual([
      ["a", "v"],
      ["b", "v"],
    ]);
  });

  it("rejects a recursive schema when recursion is unsupported", () => {
    const Category: z.ZodType = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(Category) }),
    );
    expect(() =>
      compileStructuredOutput(Category, strictCapabilities),
    ).toThrow(CruxUnsupportedSchemaError);
  });
});

describe("optional lowering — permissive profile", () => {
  it("does not lower optional properties", () => {
    const plan = compileStructuredOutput(
      optionalOnlySchema,
      permissiveCapabilities,
    );
    expect(plan.outputSchema.required ?? []).not.toContain("name");
    expect(plan.decodeManifest.operations).toEqual([]);
    expect(plan.diagnostics).toEqual([]);
  });

  it("produces a different fingerprint than the strict lowering", () => {
    const strict = compileStructuredOutput(optionalOnlySchema, strictCapabilities);
    const permissive = compileStructuredOutput(
      optionalOnlySchema,
      permissiveCapabilities,
    );
    expect(strict.fingerprint).not.toBe(permissive.fingerprint);
  });
});

describe("capability lowering — additionalProperties + keywords", () => {
  it("forces additionalProperties:false on every object under must-be-false", () => {
    const plan = compileStructuredOutput(
      z.object({ nested: z.object({ a: z.string() }) }),
      strictCapabilities,
    );
    expect(plan.outputSchema.additionalProperties).toBe(false);
    expect(props(plan.outputSchema).nested).toMatchObject({
      additionalProperties: false,
    });
  });

  it("deletes additionalProperties under 'unsupported'", () => {
    const plan = compileStructuredOutput(z.object({ a: z.string() }), {
      ...permissiveCapabilities,
      additionalProperties: "unsupported",
    });
    expect("additionalProperties" in plan.outputSchema).toBe(false);
  });

  it("drops unsupported keywords with a diagnostic", () => {
    const plan = compileStructuredOutput(z.object({ a: z.string().min(2) }), {
      ...permissiveCapabilities,
      unsupportedKeywords: ["minLength"],
    });
    expect(props(plan.outputSchema).a).not.toHaveProperty("minLength");
    expect(plan.diagnostics.map((d) => d.code)).toContain(
      "dropped-unsupported-keyword",
    );
  });
});

describe("optional lowering — determinism", () => {
  it("produces deep-equal plans for equivalent inputs", () => {
    const a = compileStructuredOutput(
      nestedOptionalObjectSchema,
      strictCapabilities,
    );
    const b = compileStructuredOutput(
      nestedOptionalObjectSchema,
      strictCapabilities,
    );
    expect(a.outputSchema).toEqual(b.outputSchema);
    expect(a.decodeManifest).toEqual(b.decodeManifest);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
