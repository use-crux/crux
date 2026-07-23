/**
 * Tool input-schema coverage: Zod, AI SDK `jsonSchema(...)` wrappers, raw JSON
 * Schema, and no-schema tools.
 *
 * `compileToolInputPlan` lowers Zod schemas (keeping a validator), unwraps a
 * `{ jsonSchema }` wrapper to the actual JSON Schema (never a nested wrapper)
 * and preserves any authored `validate`, and capability-lowers a raw JSON Schema
 * with no validator. The lifecycle exposes a wire schema for every tool that
 * declared a schema, each keyed by its own name.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compileToolInputPlan,
  DEFAULT_TOOL_INPUT_CAPABILITIES,
} from "../../../src/adapter/tool/tool-input";
import { createToolLifecycle } from "../../../src/adapter/tool/session";
import type { ResolvedPrompt } from "../../../src/resolver/types";
import { strictCapabilities } from "../structured-output/capability-fixtures";

function resolvedWith(partial: Partial<ResolvedPrompt>): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt;
}

describe("compileToolInputPlan — schema shapes", () => {
  it("lowers a Zod schema and keeps it as the sole validator", () => {
    const plan = compileToolInputPlan(
      z.object({ q: z.string() }),
      DEFAULT_TOOL_INPUT_CAPABILITIES,
    );
    expect(plan.hasAuthoredSchema).toBe(true);
    expect(plan.validate).toBeDefined();
    expect(plan.wireSchema).toMatchObject({ type: "object" });
  });

  it("unwraps an AI SDK jsonSchema({...}) wrapper without nesting", () => {
    const jsonSchema = { type: "object", properties: { q: { type: "string" } } };
    const plan = compileToolInputPlan(
      { jsonSchema },
      DEFAULT_TOOL_INPUT_CAPABILITIES,
    );
    expect(plan.hasAuthoredSchema).toBe(true);
    expect(plan.validate).toBeUndefined();
    // The wire schema is the unwrapped JSON Schema, never `{ jsonSchema: {...} }`.
    expect(plan.wireSchema).toEqual(jsonSchema);
    expect("jsonSchema" in plan.wireSchema).toBe(false);
  });

  it("capability-lowers a raw JSON Schema (no pass-through) and builds its manifest", () => {
    const raw = {
      type: "object",
      properties: { name: { type: "string" }, note: { type: "string" } },
      required: ["name"],
    };
    const plan = compileToolInputPlan(raw, strictCapabilities);
    expect(plan.hasAuthoredSchema).toBe(true);
    expect(plan.validate).toBeUndefined();
    // Strict lowering: optional `note` → required + nullable, additionalProperties: false.
    expect(plan.wireSchema.required).toEqual(["name", "note"]);
    expect(plan.wireSchema.additionalProperties).toBe(false);
    // A decode manifest reverses the transport-only sentinel.
    expect(plan.manifest.operations).toEqual([
      { kind: "delete-null-sentinel", path: ["note"] },
    ]);
  });

  it("capability-lowers a jsonSchema({...}) wrapper the same way, unwrapped", () => {
    const plan = compileToolInputPlan(
      {
        jsonSchema: {
          type: "object",
          properties: { name: { type: "string" }, note: { type: "string" } },
          required: ["name"],
        },
      },
      strictCapabilities,
    );
    expect(plan.wireSchema.required).toEqual(["name", "note"]);
    expect(plan.wireSchema.additionalProperties).toBe(false);
    expect("jsonSchema" in plan.wireSchema).toBe(false);
    expect(plan.manifest.operations).toEqual([
      { kind: "delete-null-sentinel", path: ["note"] },
    ]);
  });

  it("marks a tool with no schema as having no authored schema", () => {
    const plan = compileToolInputPlan(undefined, DEFAULT_TOOL_INPUT_CAPABILITIES);
    expect(plan.hasAuthoredSchema).toBe(false);
    expect(plan.wireSchema).toEqual({});
  });
});

describe("lifecycle tool wire schemas", () => {
  it("exposes a wire schema per tool that declared a schema, keyed by name", () => {
    const lifecycle = createToolLifecycle({
      regime: "sdk",
      resolved: resolvedWith({
        tools: {
          zod: {
            description: "zod",
            inputSchema: z.object({ a: z.string() }),
            execute: async () => "z",
          },
          wrapped: {
            description: "wrapped",
            inputSchema: {
              jsonSchema: { type: "object", properties: { b: { type: "number" } } },
            },
            execute: async () => "w",
          },
          bare: {
            description: "bare",
            execute: async () => "b",
          },
        },
      }),
      promptId: "coverage",
      input: {},
    });

    const wire = lifecycle.toolWireSchemas;
    expect(Object.keys(wire ?? {}).sort()).toEqual(["wrapped", "zod"]);
    expect(wire?.zod).toMatchObject({ type: "object" });
    // Each tool selects only its own manifest/schema — no nested wrapper.
    expect(wire?.wrapped).toEqual({
      type: "object",
      properties: { b: { type: "number" } },
    });
    // The schemaless tool is not installed.
    expect(wire?.bare).toBeUndefined();
  });
});
