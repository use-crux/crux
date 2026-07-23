/**
 * Capability field conformance matrix.
 *
 * Every public {@link StructuredOutputCapabilities} field must be truthful: a
 * declared `false`/restricted value is enforced by the compiler — either lowered
 * away reversibly or rejected before transport — never silently ignored. This
 * suite exercises one field at a time against the canonical Zod conversion path.
 *
 * `supportsBooleanSchemas` is enforced in the lowering walker but is not
 * reachable here: the canonical Zod→JSON Schema conversion never emits a boolean
 * schema (`true`/`false` in a schema position), so there is no Zod input that can
 * drive it. It is covered defensively in the walker and documented as such.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CruxInvalidCapabilityProfileError,
  CruxUnsupportedSchemaError,
  compileStructuredOutput,
} from "../../../src/adapter/structured-output";
import { permissiveCapabilities } from "./capability-fixtures";

const objectSchema = z.object({ name: z.string() });

describe("capability conformance — enforced before transport", () => {
  it("supportsNullable=false rejects a nullable schema", () => {
    const schema = z.object({ value: z.string().nullable() });
    expect(() =>
      compileStructuredOutput(schema, {
        ...permissiveCapabilities,
        supportsNullable: false,
      }),
    ).toThrow(CruxUnsupportedSchemaError);
  });

  it("supportsNullable=true keeps the null branch", () => {
    const schema = z.object({ value: z.string().nullable() });
    const plan = compileStructuredOutput(schema, permissiveCapabilities);
    expect(JSON.stringify(plan.outputSchema)).toContain('"null"');
  });

  it("supportsReferences=false rejects a recursive schema", () => {
    const Node: z.ZodType = z.lazy(() =>
      z.object({ next: Node.optional() }),
    );
    expect(() =>
      compileStructuredOutput(Node, {
        ...permissiveCapabilities,
        supportsReferences: false,
        // Keep the profile itself coherent so lowering (not profile validation)
        // is what rejects the schema.
        supportsRecursiveSchemas: false,
      }),
    ).toThrow(CruxUnsupportedSchemaError);
  });

  it("supportsRecursiveSchemas=false rejects a recursive schema", () => {
    const Node: z.ZodType = z.lazy(() =>
      z.object({ next: Node.optional() }),
    );
    expect(() =>
      compileStructuredOutput(Node, {
        ...permissiveCapabilities,
        supportsRecursiveSchemas: false,
      }),
    ).toThrow(CruxUnsupportedSchemaError);
  });

  it("supportsUnions=false rejects a multi-branch union", () => {
    const schema = z.object({ value: z.union([z.string(), z.number()]) });
    expect(() =>
      compileStructuredOutput(schema, {
        ...permissiveCapabilities,
        supportsUnions: false,
      }),
    ).toThrow(CruxUnsupportedSchemaError);
  });

  it("requiresAllProperties=true lowers optional-only properties to required+nullable", () => {
    const schema = z.object({ maybe: z.string().optional() });
    const plan = compileStructuredOutput(schema, {
      ...permissiveCapabilities,
      requiresAllProperties: true,
    });
    expect(plan.outputSchema.required).toEqual(["maybe"]);
    expect(plan.decodeManifest.operations).toEqual([
      { kind: "delete-null-sentinel", path: ["maybe"] },
    ]);
  });

  it("additionalProperties=must-be-false pins additionalProperties to false", () => {
    const plan = compileStructuredOutput(objectSchema, {
      ...permissiveCapabilities,
      additionalProperties: "must-be-false",
    });
    expect(plan.outputSchema.additionalProperties).toBe(false);
  });

  it("additionalProperties=unsupported strips the keyword", () => {
    const plan = compileStructuredOutput(objectSchema, {
      ...permissiveCapabilities,
      additionalProperties: "unsupported",
    });
    expect("additionalProperties" in plan.outputSchema).toBe(false);
  });

  it("unsupportedKeywords are dropped from the wire schema", () => {
    const schema = z.object({ tag: z.string().min(2).max(4) });
    const plan = compileStructuredOutput(schema, {
      ...permissiveCapabilities,
      unsupportedKeywords: ["minLength", "maxLength"],
    });
    const wire = JSON.stringify(plan.outputSchema);
    expect(wire).not.toContain("minLength");
    expect(wire).not.toContain("maxLength");
  });
});

describe("capability conformance — contradictions rejected at definition", () => {
  it("rejects requiresAllProperties without supportsNullable", () => {
    expect(() =>
      compileStructuredOutput(objectSchema, {
        ...permissiveCapabilities,
        requiresAllProperties: true,
        supportsNullable: false,
      }),
    ).toThrow(CruxInvalidCapabilityProfileError);
  });

  it("rejects supportsRecursiveSchemas without supportsReferences", () => {
    expect(() =>
      compileStructuredOutput(objectSchema, {
        ...permissiveCapabilities,
        supportsRecursiveSchemas: true,
        supportsReferences: false,
      }),
    ).toThrow(CruxInvalidCapabilityProfileError);
  });
});
