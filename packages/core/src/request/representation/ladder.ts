/**
 * Runtime compilation and validation of representation ladders.
 *
 * @module
 */

import type { z } from "zod";
import type { Context } from "../../prompt/context-types";
import { RequestCompositionError } from "../errors";
import type {
  ForcedOffload,
  RepresentationLadder,
  RepresentationSource,
} from "./ladder-types";

/** One legal model-facing rung compiled from authored policy. @internal */
export interface CompiledRepresentationRung {
  readonly kind:
    | "full"
    | "authored"
    | "summary"
    | "offload"
    | "omitted";
  readonly source?: RepresentationSource;
  readonly sources?: readonly RepresentationSource[];
  readonly available: boolean;
}

/** A validated linear representation ladder. @internal */
export interface CompiledRepresentationLadder {
  readonly primary: RepresentationSource;
  readonly primarySources: readonly RepresentationSource[];
  readonly rungs: readonly CompiledRepresentationRung[];
}

/** Return whether an unknown entry is a representation ladder. @internal */
export function isRepresentationLadder(
  value: unknown,
): value is RepresentationLadder {
  if (!value || typeof value !== "object") return false;
  const tag = (value as { readonly _tag?: unknown })._tag;
  return (
    tag === "prefer" ||
    tag === "summarizable" ||
    tag === "offloadable" ||
    tag === "droppable"
  );
}

/** Return whether an unknown entry forces exact-recovery representation. @internal */
export function isForcedOffload(
  value: unknown,
): value is ForcedOffload<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { readonly _tag?: unknown })._tag === "offload" &&
    "value" in value
  );
}

/** Compile one ladder or throw a redacted definition-preflight failure. @internal */
export function compileRepresentationLadder(
  ladder: RepresentationLadder,
): CompiledRepresentationLadder {
  try {
    const rungs = compileNode(ladder, new Set<object>());
    const primarySources = rungs[0]?.sources ??
      (rungs[0]?.source ? [rungs[0].source] : []);
    const primary = primarySources[0];
    if (!primary) throw new TypeError("ladder has no canonical source");
    return Object.freeze({
      primary,
      primarySources: Object.freeze(primarySources),
      rungs: Object.freeze(rungs),
    });
  } catch (error) {
    throw invalidLadder(
      error instanceof Error ? error.message : "invalid ladder structure",
    );
  }
}

/** List every exact source reachable from one ladder. @internal */
export function representationSources(
  ladder: RepresentationLadder,
): readonly RepresentationSource[] {
  return compileRepresentationLadder(ladder).rungs.flatMap((rung) =>
    rung.sources ?? (rung.source ? [rung.source] : []),
  );
}

function compileNode(
  value: unknown,
  seen: Set<object>,
): CompiledRepresentationRung[] {
  if (isContext(value)) {
    return [{ kind: "full", source: value, available: true }];
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isContext)
  ) {
    return [{
      kind: "full",
      sources: Object.freeze([...value]),
      available: true,
    }];
  }
  if (!value || typeof value !== "object") {
    throw new TypeError("representation source must be a Context");
  }
  if (seen.has(value)) throw new TypeError("representation ladder is cyclic");
  seen.add(value);

  const node = value as {
    readonly _tag?: unknown;
    readonly primary?: unknown;
    readonly alternatives?: unknown;
    readonly source?: unknown;
  };
  if (node._tag === "prefer") {
    if (!isContext(node.primary)) {
      throw new TypeError("prefer() primary must be an exact Context source");
    }
    if (
      !Array.isArray(node.alternatives) ||
      node.alternatives.length === 0 ||
      !node.alternatives.every(isContext)
    ) {
      throw new TypeError(
        "prefer() requires one or more exact Context alternatives",
      );
    }
    return [
      { kind: "full", source: node.primary, available: true },
      ...node.alternatives.map((source) => ({
        kind: "authored" as const,
        source,
        available: true,
      })),
    ];
  }
  if (node._tag === "summarizable") {
    const base = compileNonTerminal(node.source, seen, [
      "Context",
      "ContextArray",
      "prefer",
    ]);
    return [...base, { kind: "summary", available: false }];
  }
  if (node._tag === "offloadable") {
    const base = compileNonTerminal(node.source, seen, [
      "Context",
      "prefer",
      "summarizable",
    ]);
    return [...base, { kind: "offload", available: false }];
  }
  if (node._tag === "droppable") {
    const base = compileNonTerminal(node.source, seen, [
      "Context",
      "prefer",
      "summarizable",
      "offloadable",
    ]);
    return [...base, { kind: "omitted", available: true }];
  }
  throw new TypeError("unknown representation ladder tag");
}

function compileNonTerminal(
  source: unknown,
  seen: Set<object>,
  allowed: readonly string[],
): CompiledRepresentationRung[] {
  const tag = isContext(source)
    ? "Context"
    : Array.isArray(source) && source.length > 0 && source.every(isContext)
      ? "ContextArray"
    : (source as { readonly _tag?: unknown } | undefined)?._tag;
  if (typeof tag !== "string" || !allowed.includes(tag)) {
    throw new TypeError("representation wrappers are in an illegal order");
  }
  return compileNode(source, seen);
}

function isContext(
  value: unknown,
): value is Context<z.ZodType> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { readonly _tag?: unknown })._tag === "Context" &&
    typeof (value as { readonly systemFn?: unknown }).systemFn === "function"
  );
}

function invalidLadder(problem: string): RequestCompositionError {
  const requestId = "request_representation_composition";
  return new RequestCompositionError(
    "INVALID_COMPOSITION",
    `Invalid representation composition: ${problem}.`,
    [
      {
        id: `${requestId}:ladder`,
        code: "INVALID_REPRESENTATION_LADDER",
        contributor: "representation",
        message:
          "Use the fixed source → prefer → summarizable → offloadable → droppable order.",
      },
    ],
    requestId,
  );
}
