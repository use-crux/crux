/**
 * Raw-schema semantic closure holds under composition.
 *
 * Two compositional cases must not bypass the closed subset: (1) an object schema
 * without `properties` must still have `additionalProperties` normalized for the
 * profile, and (2) genuine null composed inside `anyOf`/`oneOf` (via `const`,
 * `enum`, or a nullable type array) must be recognized as nullability — preserved
 * without a delete-null-sentinel and rejected under `supportsNullable: false` —
 * while a null-only branch does not count toward `supportsUnions`.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
  compileCanonicalSchema,
  CruxUnsupportedSchemaError,
  decodeStructuredValue,
  type StructuredOutputCapabilities,
} from "../../../src/adapter/structured-output";
import {
  permissiveCapabilities,
  strictCapabilities,
} from "./capability-fixtures";

const raw = { rawSchema: true } as const;

const mustBeFalse = strictCapabilities; // additionalProperties: "must-be-false"

const unsupportedAdditional: StructuredOutputCapabilities = {
  ...permissiveCapabilities,
  id: "test.permissive.ap-unsupported",
  additionalProperties: "unsupported",
};

const noNull: StructuredOutputCapabilities = {
  ...permissiveCapabilities,
  id: "test.permissive.no-null",
  supportsNullable: false,
};

const noUnions: StructuredOutputCapabilities = {
  ...permissiveCapabilities,
  id: "test.permissive.no-unions",
  supportsUnions: false,
};

describe("object capability lowering without `properties`", () => {
  it("forces `additionalProperties: false` for a propertyless object under must-be-false", () => {
    const plan = compileCanonicalSchema(
      { type: "object", additionalProperties: true },
      mustBeFalse,
      raw,
    );
    expect(plan.outputSchema.additionalProperties).toBe(false);
  });

  it("deletes `additionalProperties` for a propertyless object under unsupported", () => {
    const plan = compileCanonicalSchema(
      { type: "object", additionalProperties: true },
      unsupportedAdditional,
      raw,
    );
    expect("additionalProperties" in plan.outputSchema).toBe(false);
  });

  it("leaves `additionalProperties` for a propertyless object under supported", () => {
    const plan = compileCanonicalSchema(
      { type: "object", additionalProperties: true },
      permissiveCapabilities,
      raw,
    );
    expect(plan.outputSchema.additionalProperties).toBe(true);
  });

  it("normalizes `additionalProperties` on a nested propertyless object", () => {
    const plan = compileCanonicalSchema(
      {
        type: "object",
        properties: {
          bag: { type: "object", additionalProperties: true },
        },
        required: ["bag"],
      },
      mustBeFalse,
      raw,
    );
    const bag = (plan.outputSchema.properties as Record<string, { additionalProperties?: unknown }>)
      .bag;
    expect(bag.additionalProperties).toBe(false);
  });
});

describe("composed nullability inside unions", () => {
  const nullableUnionForms = [
    { anyOf: [{ const: null }, { type: "string" }] },
    { anyOf: [{ enum: [null] }, { type: "string" }] },
    { oneOf: [{ const: null }, { type: "string" }] },
    { anyOf: [{ type: ["string", "null"] }, { type: "number" }] },
  ];

  it("preserves composed null in an optional property with no delete operation (strict)", () => {
    for (const form of nullableUnionForms) {
      const plan = compileCanonicalSchema(
        { type: "object", properties: { v: form }, required: [] },
        strictCapabilities,
        raw,
      );
      // The property already accepts null through a union branch, so strict
      // lowering records no delete-null-sentinel and never deletes the null.
      expect(plan.decodeManifest.operations).toEqual([]);
      expect(decodeStructuredValue({ v: null }, plan.decodeManifest)).toEqual({
        v: null,
      });
    }
  });

  it("rejects composed-null unions under `supportsNullable: false`", () => {
    for (const form of nullableUnionForms) {
      expect(() =>
        compileCanonicalSchema(
          { type: "object", properties: { v: form }, required: ["v"] },
          noNull,
          raw,
        ),
      ).toThrow(CruxUnsupportedSchemaError);
    }
  });

  it("does not count a null-only branch toward union support", () => {
    // One real branch + a null-only branch → not a multi-branch union, so it
    // compiles even when `supportsUnions` is false.
    const plan = compileCanonicalSchema(
      {
        type: "object",
        properties: { v: { anyOf: [{ type: "string" }, { const: null }] } },
        required: ["v"],
      },
      noUnions,
      raw,
    );
    expect(decodeStructuredValue({ v: null }, plan.decodeManifest)).toEqual({
      v: null,
    });
  });

  it("still counts a mixed null-accepting branch as a real union branch", () => {
    // `{ enum: [null, "x"] }` accepts null but is not null-only, so two real
    // branches remain and an unsupported-union profile must reject.
    expect(() =>
      compileCanonicalSchema(
        {
          type: "object",
          properties: {
            v: { anyOf: [{ enum: [null, "x"] }, { type: "number" }] },
          },
          required: ["v"],
        },
        noUnions,
        raw,
      ),
    ).toThrow(CruxUnsupportedSchemaError);
  });
});

describe("raw preflight shape rejections", () => {
  it("rejects unknown type names, empty/duplicate type arrays, and empty unions", () => {
    const malformed: unknown[] = [
      { type: "objct" },
      { type: [] },
      { type: ["string", "string"] },
      { anyOf: [] },
      { oneOf: [] },
      { additionalProperties: true }, // no `type: "object"`
      { required: ["a"] }, // no `type: "object"`
    ];
    for (const schema of malformed) {
      expect(() =>
        compileCanonicalSchema(schema as never, permissiveCapabilities, raw),
      ).toThrow(CruxUnsupportedSchemaError);
    }
  });
});
