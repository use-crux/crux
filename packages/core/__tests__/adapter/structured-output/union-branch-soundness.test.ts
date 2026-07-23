/**
 * Union lowering is branch-safe, and `oneOf` nullability is not mistaken for a
 * transport sentinel.
 *
 * The decode manifest is a flat, branch-unaware path list. An operation recorded
 * while lowering one union branch would be applied unconditionally at decode
 * time and could reject a valid value that selected a different branch. So any
 * union branch whose lowering emits a decode operation is rejected before
 * transport — the same conservative rule already used for recursive schemas. A
 * decode operation *outside* a union (e.g. an optional property whose value
 * happens to be a union) stays supported. Separately, a genuine `null` branch in
 * a `oneOf` is real nullability, not an optional sentinel.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compileCanonicalSchema,
  compileStructuredOutput,
  CruxUnsupportedSchemaError,
  decodeStructuredValue,
  type StructuredOutputCapabilities,
} from "../../../src/adapter/structured-output";
import {
  permissiveCapabilities,
  strictCapabilities,
} from "./capability-fixtures";

// `requiresAllProperties` needs `supportsNullable`, so the negative-capability
// profiles are based on the permissive fixture (optional properties left as-is).
const noNull: StructuredOutputCapabilities = {
  ...permissiveCapabilities,
  id: "test.permissive.no-null",
  supportsNullable: false,
};

const noBool: StructuredOutputCapabilities = {
  ...permissiveCapabilities,
  id: "test.permissive.no-bool",
  supportsBooleanSchemas: false,
};

describe("union branch-dependent decode operations", () => {
  it("rejects a branch-dependent optional lowering before transport", () => {
    // Under strict lowering, the first branch's optional `note` would record a
    // `["config","note"]` op that a valid second-branch `{ config: "plain" }`
    // could not satisfy. Compilation must fail instead.
    const schema = z.union([
      z.object({ config: z.object({ note: z.string().optional() }) }),
      z.object({ config: z.string() }),
    ]);
    expect(() => compileStructuredOutput(schema, strictCapabilities)).toThrow(
      CruxUnsupportedSchemaError,
    );
  });

  it("keeps a plain union (no decode ops) and never rejects a selected branch", () => {
    const schema = z.union([
      z.object({ a: z.string() }),
      z.object({ b: z.number() }),
    ]);
    const plan = compileStructuredOutput(schema, strictCapabilities);
    // No branch produced a decode operation, so decoding is identity for either
    // selected branch and can never reject a valid value.
    expect(plan.decodeManifest.operations).toEqual([]);
    expect(decodeStructuredValue({ a: "x" }, plan.decodeManifest)).toEqual({
      a: "x",
    });
    expect(decodeStructuredValue({ b: 3 }, plan.decodeManifest)).toEqual({
      b: 3,
    });
  });

  it("supports an optional property whose value is itself a union (op outside the union)", () => {
    const schema = z.object({
      note: z.union([z.string(), z.number()]).optional(),
    });
    const plan = compileStructuredOutput(schema, strictCapabilities);
    // The delete-null-sentinel op is on the property, not inside the union, so it
    // is reversible regardless of which union branch the value selects.
    expect(plan.decodeManifest.operations).toEqual([
      { kind: "delete-null-sentinel", path: ["note"] },
    ]);
    expect(decodeStructuredValue({ note: null }, plan.decodeManifest)).toEqual(
      {},
    );
    expect(decodeStructuredValue({ note: "x" }, plan.decodeManifest)).toEqual({
      note: "x",
    });
  });

  it("applies the same rule to a raw `oneOf` branch", () => {
    const raw = {
      oneOf: [
        {
          type: "object",
          properties: {
            config: {
              type: "object",
              properties: { note: { type: "string" } },
              required: [],
            },
          },
          required: ["config"],
        },
        { type: "object", properties: { config: { type: "string" } }, required: ["config"] },
      ],
    };
    expect(() => compileCanonicalSchema(raw, strictCapabilities, { rawSchema: true })).toThrow(
      CruxUnsupportedSchemaError,
    );
  });
});

describe("oneOf nullability", () => {
  it("rejects a genuine null `oneOf` branch when the profile cannot represent null", () => {
    const raw = {
      type: "object",
      properties: {
        value: { oneOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["value"],
    };
    expect(() => compileCanonicalSchema(raw, noNull, { rawSchema: true })).toThrow(
      CruxUnsupportedSchemaError,
    );
  });

  it("keeps a real null `oneOf` value and records no sentinel-delete op", () => {
    const raw = {
      type: "object",
      properties: {
        value: { oneOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["value"],
    };
    const plan = compileCanonicalSchema(raw, strictCapabilities, {
      rawSchema: true,
    });
    // `value` is already nullable, so strict lowering adds no optional sentinel.
    expect(plan.decodeManifest.operations).toEqual([]);
    expect(decodeStructuredValue({ value: null }, plan.decodeManifest)).toEqual({
      value: null,
    });
  });

  it("rejects a boolean schema in a nested position when unsupported", () => {
    const raw = {
      type: "object",
      properties: { flag: true },
      required: ["flag"],
    };
    expect(() => compileCanonicalSchema(raw, noBool, { rawSchema: true })).toThrow(
      CruxUnsupportedSchemaError,
    );
  });
});
