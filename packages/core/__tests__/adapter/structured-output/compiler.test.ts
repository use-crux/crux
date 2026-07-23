/**
 * Structured-output capability compiler contract.
 *
 * Covers profile validation (contradictions + unsupported structured output),
 * deterministic canonical compilation, plan/fingerprint determinism, plan and
 * input immutability, description retention, and empty-manifest decode
 * reference preservation. Semantic lowering is not exercised here — the skeleton
 * produces a canonical no-op plan.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CruxInvalidCapabilityProfileError,
  CruxUnsupportedStructuredOutputError,
  compileStructuredOutput,
  decodeStructuredValue,
} from "../../../src/adapter/structured-output";
import {
  permissiveCapabilities,
  strictCapabilities,
} from "./capability-fixtures";

const simpleSchema = z.object({ name: z.string(), count: z.number() });

describe("compileStructuredOutput — profile validation", () => {
  it("compiles a plan for a valid minimal profile", () => {
    const plan = compileStructuredOutput(simpleSchema, permissiveCapabilities);

    expect(plan.outputSchema).toMatchObject({ type: "object" });
    expect(plan.decodeManifest.operations).toEqual([]);
    expect(plan.diagnostics).toEqual([]);
    expect(typeof plan.fingerprint).toBe("string");
    expect(plan.fingerprint.length).toBeGreaterThan(0);
  });

  it("rejects a profile that requires all properties without nullable support", () => {
    expect(() =>
      compileStructuredOutput(simpleSchema, {
        ...strictCapabilities,
        supportsNullable: false,
      }),
    ).toThrow(CruxInvalidCapabilityProfileError);
  });

  it("rejects a profile that neither requires all properties nor supports optional", () => {
    expect(() =>
      compileStructuredOutput(simpleSchema, {
        ...permissiveCapabilities,
        requiresAllProperties: false,
        supportsOptionalProperties: false,
      }),
    ).toThrow(CruxInvalidCapabilityProfileError);
  });

  it("rejects a profile with an empty id", () => {
    expect(() =>
      compileStructuredOutput(simpleSchema, { ...permissiveCapabilities, id: "" }),
    ).toThrow(CruxInvalidCapabilityProfileError);
  });

  it("names the profile id and conflicts in the invalid-profile error", () => {
    try {
      compileStructuredOutput(simpleSchema, {
        ...strictCapabilities,
        id: "provider.bad",
        supportsNullable: false,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CruxInvalidCapabilityProfileError);
      const profileError = error as CruxInvalidCapabilityProfileError;
      expect(profileError.profileId).toBe("provider.bad");
      expect(profileError.conflicts.length).toBeGreaterThan(0);
    }
  });

  it("rejects structured output when the profile cannot accept JSON Schema", () => {
    expect(() =>
      compileStructuredOutput(simpleSchema, {
        ...permissiveCapabilities,
        supportsJsonSchema: false,
      }),
    ).toThrow(CruxUnsupportedStructuredOutputError);
  });
});

describe("compileStructuredOutput — determinism", () => {
  it("produces deep-equal plans and identical fingerprints for equivalent inputs", () => {
    const a = compileStructuredOutput(
      z.object({ name: z.string(), count: z.number() }),
      { ...permissiveCapabilities },
    );
    const b = compileStructuredOutput(
      z.object({ name: z.string(), count: z.number() }),
      { ...permissiveCapabilities },
    );

    expect(a.outputSchema).toEqual(b.outputSchema);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("changes the fingerprint when the schema differs", () => {
    const a = compileStructuredOutput(z.object({ a: z.string() }), permissiveCapabilities);
    const b = compileStructuredOutput(z.object({ b: z.string() }), permissiveCapabilities);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("changes the fingerprint when a capability value differs", () => {
    const a = compileStructuredOutput(simpleSchema, permissiveCapabilities);
    const b = compileStructuredOutput(simpleSchema, {
      ...permissiveCapabilities,
      additionalProperties: "must-be-false",
    });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("compileStructuredOutput — immutability", () => {
  it("returns a deeply frozen plan", () => {
    const plan = compileStructuredOutput(simpleSchema, permissiveCapabilities);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.outputSchema)).toBe(true);
    expect(Object.isFrozen(plan.decodeManifest)).toBe(true);
    expect(Object.isFrozen(plan.decodeManifest.operations)).toBe(true);
    expect(Object.isFrozen(plan.diagnostics)).toBe(true);
  });

  it("does not mutate the capability profile passed in", () => {
    const capabilities = { ...permissiveCapabilities };
    const snapshot = JSON.stringify(capabilities);
    compileStructuredOutput(simpleSchema, capabilities);
    expect(JSON.stringify(capabilities)).toBe(snapshot);
  });
});

describe("compileStructuredOutput — canonical schema", () => {
  it("retains authored descriptions", () => {
    const schema = z.object({
      name: z.string().describe("the user's name"),
    });
    const plan = compileStructuredOutput(schema, permissiveCapabilities);
    const properties = plan.outputSchema.properties as Record<
      string,
      { description?: string }
    >;
    expect(properties.name?.description).toBe("the user's name");
  });
});

describe("decodeStructuredValue — empty manifest", () => {
  it("returns the exact same value reference when the manifest is empty", () => {
    const plan = compileStructuredOutput(simpleSchema, permissiveCapabilities);
    const value = { name: "ada", count: 1 };
    expect(decodeStructuredValue(value, plan.decodeManifest)).toBe(value);
  });
});
