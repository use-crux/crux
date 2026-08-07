/**
 * Discriminated-union branch guards on decode operations.
 *
 * A `delete-null-sentinel` recorded inside a discriminated-union branch carries
 * guards naming the branch's discriminator, so decoding applies it only to
 * values that selected that branch. Ambiguous (non-discriminated) unions whose
 * branches would need operations remain rejected before transport.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compileStructuredOutput,
  decodeStructuredValue,
} from "../../../src/adapter/structured-output";
import { strictCapabilities } from "./capability-fixtures";

describe("discriminated union with a branch-level optional field", () => {
  it("compiles under strict lowering and records a guarded delete-null-sentinel", () => {
    const schema = z.discriminatedUnion("status", [
      z.object({
        status: z.literal("resolved"),
        replacementAssertionId: z.string().optional(),
      }),
      z.object({ status: z.literal("open"), note: z.string().nullable() }),
    ]);
    const plan = compileStructuredOutput(schema, strictCapabilities);
    expect(plan.decodeManifest.operations).toEqual([
      {
        kind: "delete-null-sentinel",
        path: ["replacementAssertionId"],
        guards: [{ depth: 0, key: "status", value: "resolved" }],
      },
    ]);
  });

  it("preserves a genuine authored null at the same key in the other branch", () => {
    // Branch "a" lowers optional `x` with a guarded delete; branch "b" authors
    // `x` as genuinely nullable. A branch-"b" null must survive decoding.
    const schema = z.discriminatedUnion("status", [
      z.object({ status: z.literal("a"), x: z.string().optional() }),
      z.object({ status: z.literal("b"), x: z.string().nullable() }),
    ]);
    const plan = compileStructuredOutput(schema, strictCapabilities);
    expect(
      decodeStructuredValue({ status: "b", x: null }, plan.decodeManifest),
    ).toEqual({ status: "b", x: null });
  });

  it("deletes the null sentinel on the branch that selected it", () => {
    const schema = z.discriminatedUnion("status", [
      z.object({ status: z.literal("a"), x: z.string().optional() }),
      z.object({ status: z.literal("b"), x: z.string().nullable() }),
    ]);
    const plan = compileStructuredOutput(schema, strictCapabilities);
    expect(
      decodeStructuredValue({ status: "a", x: null }, plan.decodeManifest),
    ).toEqual({ status: "a" });
    expect(
      decodeStructuredValue({ status: "a", x: "kept" }, plan.decodeManifest),
    ).toEqual({ status: "a", x: "kept" });
  });

  it("applies guards per element for a union under an array wildcard", () => {
    const schema = z.object({
      events: z.array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("note"), text: z.string().optional() }),
          z.object({ kind: z.literal("link"), text: z.string().nullable() }),
        ]),
      ),
    });
    const plan = compileStructuredOutput(schema, strictCapabilities);
    expect(plan.decodeManifest.operations).toEqual([
      {
        kind: "delete-null-sentinel",
        path: ["events", "*", "text"],
        guards: [{ depth: 2, key: "kind", value: "note" }],
      },
    ]);
    const value = {
      events: [
        { kind: "note", text: null },
        { kind: "link", text: null },
      ],
    };
    expect(decodeStructuredValue(value, plan.decodeManifest)).toEqual({
      events: [{ kind: "note" }, { kind: "link", text: null }],
    });
  });

  it("composes guards for a discriminated union nested inside a branch", () => {
    const inner = z.discriminatedUnion("type", [
      z.object({ type: z.literal("x"), note: z.string().optional() }),
      z.object({ type: z.literal("y"), note: z.string().nullable() }),
    ]);
    const schema = z.discriminatedUnion("status", [
      z.object({ status: z.literal("a"), detail: inner }),
      z.object({ status: z.literal("b") }),
    ]);
    const plan = compileStructuredOutput(schema, strictCapabilities);
    expect(plan.decodeManifest.operations).toEqual([
      {
        kind: "delete-null-sentinel",
        path: ["detail", "note"],
        guards: [
          { depth: 0, key: "status", value: "a" },
          { depth: 1, key: "type", value: "x" },
        ],
      },
    ]);
    expect(
      decodeStructuredValue(
        { status: "a", detail: { type: "x", note: null } },
        plan.decodeManifest,
      ),
    ).toEqual({ status: "a", detail: { type: "x" } });
    expect(
      decodeStructuredValue(
        { status: "a", detail: { type: "y", note: null } },
        plan.decodeManifest,
      ),
    ).toEqual({ status: "a", detail: { type: "y", note: null } });
  });
});
