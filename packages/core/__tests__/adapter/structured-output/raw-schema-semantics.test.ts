/**
 * Raw tool input schemas are closed by schema semantics, not just keyword name.
 *
 * Lowering only descends into `properties`/`items` under an explicit matching
 * `type`, expresses null through `type`/`enum`/`const`/union branches, and gates
 * unions on `supportsUnions`. A raw schema that omits the required `type`, uses
 * the noncanonical `nullable` keyword, expresses null through `enum`/`const`,
 * uses a multi-type `type` array, or carries a malformed accepted-keyword value
 * must therefore fail closed (or, for genuine null, be preserved) before any
 * provider request.
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

const noNull: StructuredOutputCapabilities = {
  ...permissiveCapabilities,
  id: "test.permissive.no-null",
  supportsNullable: false,
};

describe("raw schema semantic closure — typed applicators", () => {
  it("rejects `properties` without an explicit `type: \"object\"`", () => {
    const schema = { properties: { name: { type: "string" } }, required: ["name"] };
    expect(() => compileCanonicalSchema(schema, strictCapabilities, raw)).toThrow(
      CruxUnsupportedSchemaError,
    );
  });

  it("rejects `items` without an explicit `type: \"array\"`", () => {
    const schema = { items: { type: "string" } };
    expect(() => compileCanonicalSchema(schema, strictCapabilities, raw)).toThrow(
      CruxUnsupportedSchemaError,
    );
  });

  it("rejects a multi-type `type` array (a union outside supportsUnions)", () => {
    const schema = {
      type: "object",
      properties: { v: { type: ["string", "number"] } },
      required: ["v"],
    };
    expect(() => compileCanonicalSchema(schema, strictCapabilities, raw)).toThrow(
      CruxUnsupportedSchemaError,
    );
  });
});

describe("raw schema semantic closure — nullability", () => {
  it("rejects the noncanonical `nullable` keyword rather than transporting it", () => {
    const schema = {
      type: "object",
      properties: { v: { type: "string", nullable: true } },
      required: ["v"],
    };
    expect(() => compileCanonicalSchema(schema, strictCapabilities, raw)).toThrow(
      CruxUnsupportedSchemaError,
    );
  });

  it("preserves a nullable `enum` value with no delete operation under strict lowering", () => {
    const schema = {
      type: "object",
      properties: { v: { enum: [null, "x"] } },
      required: ["v"],
    };
    const plan = compileCanonicalSchema(schema, strictCapabilities, raw);
    expect(plan.decodeManifest.operations).toEqual([]);
    expect(decodeStructuredValue({ v: null }, plan.decodeManifest)).toEqual({
      v: null,
    });
  });

  it("preserves a `const: null` value with no delete operation under strict lowering", () => {
    const schema = {
      type: "object",
      properties: { v: { const: null } },
      required: ["v"],
    };
    const plan = compileCanonicalSchema(schema, strictCapabilities, raw);
    expect(plan.decodeManifest.operations).toEqual([]);
    expect(decodeStructuredValue({ v: null }, plan.decodeManifest)).toEqual({
      v: null,
    });
  });

  it("rejects nullable `enum`/`const` under `supportsNullable: false`", () => {
    for (const property of [{ enum: [null, "x"] }, { const: null }]) {
      const schema = {
        type: "object",
        properties: { v: property },
        required: ["v"],
      };
      expect(() => compileCanonicalSchema(schema, noNull, raw)).toThrow(
        CruxUnsupportedSchemaError,
      );
    }
  });
});

describe("raw schema semantic closure — malformed shapes", () => {
  it("rejects malformed accepted-keyword shapes before transport", () => {
    const malformed: unknown[] = [
      { type: "object", properties: "nope" },
      { type: "object", properties: { name: { type: "string" } }, required: "name" },
      { type: "object", properties: { name: { type: "string" } }, required: [1] },
      { anyOf: "not-an-array" },
      { type: 5 },
      { type: "object", properties: { bad: "not-a-schema" } },
    ];
    for (const schema of malformed) {
      expect(() =>
        compileCanonicalSchema(schema as never, permissiveCapabilities, raw),
      ).toThrow(CruxUnsupportedSchemaError);
    }
  });
});
