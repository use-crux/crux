/**
 * Raw / non-Zod tool input schema compilation: soundness and non-mutation.
 *
 * `compileToolInputPlan` compiles a caller-authored raw JSON Schema (or an AI
 * SDK `jsonSchema(...)` wrapper) against a capability profile using a closed
 * supported vocabulary. Constructs it cannot soundly represent are rejected
 * before any provider request, the caller's schema is never mutated or frozen,
 * and the compiled plan shares no mutable container with it. Deferred, Standard
 * Schema, and unrecognized shapes are rejected up front.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
  compileToolInputPlan,
  DEFAULT_TOOL_INPUT_CAPABILITIES,
} from "../../../src/adapter/tool/tool-input";
import {
  CruxUnsupportedSchemaError,
  CruxUnsupportedStructuredOutputError,
  type StructuredOutputCapabilities,
} from "../../../src/adapter/structured-output";
import { strictCapabilities } from "../structured-output/capability-fixtures";

const noUnions: StructuredOutputCapabilities = {
  ...DEFAULT_TOOL_INPUT_CAPABILITIES,
  id: "test.no-unions",
  supportsUnions: false,
};

describe("compileToolInputPlan — raw schema soundness", () => {
  it("honors supportsUnions for a raw `oneOf`, not just `anyOf`", () => {
    const oneOf = {
      oneOf: [{ type: "string" }, { type: "number" }],
    };
    expect(() => compileToolInputPlan(oneOf, noUnions)).toThrow(
      CruxUnsupportedSchemaError,
    );
    // A capability profile that supports unions compiles it and lowers branches.
    const plan = compileToolInputPlan(oneOf, DEFAULT_TOOL_INPUT_CAPABILITIES);
    expect(plan.wireSchema.oneOf).toHaveLength(2);
  });

  it("cannot bypass capability checks through a nested union keyword", () => {
    const nested = {
      type: "object",
      properties: {
        choice: { oneOf: [{ type: "string" }, { type: "number" }] },
      },
      required: ["choice"],
    };
    expect(() => compileToolInputPlan(nested, noUnions)).toThrow(
      CruxUnsupportedSchemaError,
    );
  });

  it("rejects a raw `$ref`/`$defs` rather than emitting an unresolved reference", () => {
    const withDefs = {
      type: "object",
      properties: { self: { $ref: "#/$defs/node" } },
      required: ["self"],
      $defs: { node: { type: "string" } },
    };
    expect(() =>
      compileToolInputPlan(withDefs, DEFAULT_TOOL_INPUT_CAPABILITIES),
    ).toThrow(CruxUnsupportedSchemaError);
  });

  it("rejects other structural keywords that would bypass lowering", () => {
    for (const schema of [
      { allOf: [{ type: "object" }] },
      { if: { type: "string" }, then: { type: "string" } },
      { type: "object", additionalProperties: { type: "string" } },
      { type: "array", items: [{ type: "string" }] },
    ]) {
      expect(() =>
        compileToolInputPlan(schema, DEFAULT_TOOL_INPUT_CAPABILITIES),
      ).toThrow(CruxUnsupportedSchemaError);
    }
  });

  it("never mutates or freezes the caller's raw schema", () => {
    const raw = {
      type: "object",
      properties: { name: { type: "string" }, note: { type: "string" } },
      required: ["name"],
    };
    const plan = compileToolInputPlan(raw, strictCapabilities);

    // The authored schema is untouched: still mutable, `required` unchanged.
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(raw.properties)).toBe(false);
    expect(raw.required).toEqual(["name"]);
    expect(() => {
      (raw.properties as Record<string, unknown>).added = { type: "string" };
    }).not.toThrow();

    // The plan shares no mutable container with the caller's schema.
    expect(plan.wireSchema).not.toBe(raw);
    expect(plan.wireSchema.properties).not.toBe(raw.properties);
    // Strict lowering still applied to the plan's own (frozen) wire schema.
    expect(plan.wireSchema.required).toEqual(["name", "note"]);
    expect(Object.isFrozen(plan.wireSchema)).toBe(true);
  });
});

describe("compileToolInputPlan — unsupported non-Zod shapes", () => {
  it("rejects a deferred (Promise-based) schema before any provider call", () => {
    const deferred = Promise.resolve({ type: "object" });
    expect(() =>
      compileToolInputPlan(deferred, DEFAULT_TOOL_INPUT_CAPABILITIES),
    ).toThrow(CruxUnsupportedStructuredOutputError);
  });

  it("rejects a deferred `jsonSchema` wrapper before any provider call", () => {
    const wrapper = { jsonSchema: Promise.resolve({ type: "object" }) };
    expect(() =>
      compileToolInputPlan(wrapper, DEFAULT_TOOL_INPUT_CAPABILITIES),
    ).toThrow(CruxUnsupportedStructuredOutputError);
  });

  it("rejects a Standard Schema without a JSON Schema", () => {
    const standard = {
      "~standard": { version: 1, vendor: "x", validate: () => ({ value: {} }) },
    };
    expect(() =>
      compileToolInputPlan(standard, DEFAULT_TOOL_INPUT_CAPABILITIES),
    ).toThrow(CruxUnsupportedStructuredOutputError);
  });

  it("rejects an AI SDK lazy (function) schema with an actionable error, not an incidental parse failure", () => {
    const lazy = () => ({ type: "object", properties: {} });
    expect(() =>
      compileToolInputPlan(lazy, DEFAULT_TOOL_INPUT_CAPABILITIES),
    ).toThrow(CruxUnsupportedStructuredOutputError);
  });

  it("rejects a primitive input with the same typed error (no `in`-operator failure)", () => {
    for (const primitive of ["a schema", 42, true]) {
      expect(() =>
        compileToolInputPlan(primitive, DEFAULT_TOOL_INPUT_CAPABILITIES),
      ).toThrow(CruxUnsupportedStructuredOutputError);
    }
  });
});
