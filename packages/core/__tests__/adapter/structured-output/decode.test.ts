/**
 * Canonical decode contract.
 *
 * Decoding reverses transport-only lowering before Safety and Zod: a provider
 * `null` at a `delete-null-sentinel` occurrence deletes that property; genuine
 * null with no operation is preserved. Decoding never mutates the provider value
 * (copy-on-write, cloning only changed ancestors) and returns the original
 * reference when nothing changes.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import {
  CruxStructuredOutputDecodeError,
  compileStructuredOutput,
  decodeStructuredValue,
} from "../../../src/adapter/structured-output";
import {
  nestedOptionalObjectSchema,
  optionalArrayElementSchema,
  optionalOnlySchema,
} from "./normalization-fixtures";
import { strictCapabilities } from "./capability-fixtures";

const manifestFor = (schema: Parameters<typeof compileStructuredOutput>[0]) =>
  compileStructuredOutput(schema, strictCapabilities).decodeManifest;

describe("decodeStructuredValue — delete-null-sentinel", () => {
  it("deletes a top-level sentinel null property", () => {
    const manifest = manifestFor(optionalOnlySchema);
    const decoded = decodeStructuredValue({ name: null }, manifest);
    expect(decoded).toEqual({});
  });

  it("keeps a non-null value and returns the same reference", () => {
    const manifest = manifestFor(optionalOnlySchema);
    const value = { name: "ada" };
    expect(decodeStructuredValue(value, manifest)).toBe(value);
  });

  it("deletes a nested sentinel and clones only changed ancestors", () => {
    const manifest = manifestFor(nestedOptionalObjectSchema);
    const value = { user: { email: null } };
    const decoded = decodeStructuredValue(value, manifest);
    expect(decoded).toEqual({ user: {} });
    // Source is not mutated.
    expect(value).toEqual({ user: { email: null } });
    expect(decoded).not.toBe(value);
  });

  it("deletes a null parent occurrence and skips the descendant op", () => {
    const manifest = manifestFor(nestedOptionalObjectSchema);
    const decoded = decodeStructuredValue({ user: null }, manifest);
    expect(decoded).toEqual({});
  });

  it("applies a wildcard delete to each array element", () => {
    const manifest = manifestFor(optionalArrayElementSchema);
    const value = { items: [{ tag: null }, { tag: "x" }, { tag: null }] };
    const decoded = decodeStructuredValue(value, manifest);
    expect(decoded).toEqual({ items: [{}, { tag: "x" }, {}] });
    // Unchanged element keeps its reference.
    expect((decoded as { items: unknown[] }).items[1]).toBe(value.items[1]);
  });

  it("returns the same reference when the empty manifest applies", () => {
    const value = { name: "ada" };
    expect(
      decodeStructuredValue(value, { version: 1, operations: [] }),
    ).toBe(value);
  });

  it("skips a missing ancestor without failing", () => {
    const manifest = manifestFor(nestedOptionalObjectSchema);
    const value = {};
    expect(decodeStructuredValue(value, manifest)).toBe(value);
  });

  it("fails with a typed decode error on a path shape conflict", () => {
    const manifest = manifestFor(nestedOptionalObjectSchema);
    expect(() =>
      decodeStructuredValue({ user: "not-an-object" }, manifest),
    ).toThrow(CruxStructuredOutputDecodeError);
  });
});
