/**
 * Read-only control-resource access for request preparation.
 *
 * @module
 */

import type { ContextEntry } from "../../prompt/context-types";
import { sha256Hex } from "../../content/sha256";
import {
  isRepresentationLadder,
  representationSources,
} from "../representation/ladder";
import { registerPreparationResources } from "./pin-context";

/** Runtime reader attached only by supported structured-resource factories. @internal */
export const CONTROL_RESOURCE_RUNTIME: unique symbol = Symbol.for(
  "crux.prepare.control-resource",
);

/** Runtime binder attached by resource containers such as Memory. @internal */
export const CONTROL_RESOURCE_BINDER: unique symbol = Symbol.for(
  "crux.prepare.control-resource-binder",
);

/** Nominal type carrier attached by supported structured-resource factories. @internal */
export const CONTROL_RESOURCE_TYPE: unique symbol = Symbol.for(
  "crux.prepare.control-resource-type",
);

/**
 * A structured resource that may be read during request preparation.
 *
 * Applications receive these handles from supported factories such as
 * `workingState()` and `blackboard()`; arbitrary storage handles are excluded.
 */
export interface ControlReadable<T> {
  /** Stable resource identity used for declaration and replay checks. */
  readonly id: string;
  /** @internal Nominal value-type carrier. */
  readonly [CONTROL_RESOURCE_TYPE]: (value: T) => T;
  /** @internal Core-owned reader metadata. */
  readonly [CONTROL_RESOURCE_RUNTIME]?: ControlResourceRuntime<T>;
}

/** Internal reader contract carried by a supported resource handle. @internal */
export interface ControlResourceRuntime<T> {
  readonly kind: "working-state" | "blackboard";
  read(context?: unknown): Promise<T | null>;
}

/** Stable reasons why a control-resource read could not produce a value. */
export type ResourceReadErrorReason =
  | "undeclared"
  | "unauthorized"
  | "unresolved"
  | "storage-unavailable";

/** A typed, content-free control-resource read failure. */
export class ResourceReadError extends Error {
  /** Stable reason suitable for explicit fallback logic. */
  readonly reason: ResourceReadErrorReason;

  /**
   * Create a resource read failure.
   *
   * @param reason - Stable failure classification.
   */
  constructor(reason: ResourceReadErrorReason) {
    super(`Preparation resource read failed: ${reason}.`);
    this.name = "ResourceReadError";
    this.reason = reason;
  }
}

/**
 * Read-only resource mediator scoped to one preparation boundary.
 *
 * @example
 * ```ts
 * async prepareStep({ resources }) {
 *   const state = await resources.read(controlState)
 *   return state?.urgent ? { model: urgentModel } : undefined
 * }
 * ```
 */
export interface PreparationResources {
  /**
   * Read a declared structured resource at one pinned boundary revision.
   *
   * `null` means the resource is readable but has no value. Abnormal states
   * reject with {@link ResourceReadError}; preparation never exposes writes.
   *
   * @param resource - A supported handle inherited from the declared graph.
   * @returns The pinned value, or `null` when no value exists.
   */
  read<T>(resource: ControlReadable<T>): Promise<T | null>;
}

/** Content-free record of one pinned boundary read. @internal */
export interface PreparationResourceRead {
  readonly identity: string;
  readonly revision: string;
  readonly valueHash: string;
}

interface ResourceBinding {
  readonly identity: string;
  read(): Promise<unknown | null>;
}

interface PreparationResourceState extends PreparationResources {
  readonly reads: PreparationResourceRead[];
}

/** Create a boundary-local mediator from the inherited declared graph. @internal */
export function createPreparationResources(input: {
  readonly entries: readonly ContextEntry[];
  readonly requestInput: Readonly<Record<string, unknown>>;
  readonly promptId?: string;
}): PreparationResources {
  const bindings = new Map<object, ResourceBinding>();
  collectEntries(input.entries, bindings, input);
  const memo = new Map<object, Promise<unknown | null>>();
  const state: PreparationResourceState = {
    reads: [],
    async read<T>(resource: ControlReadable<T>): Promise<T | null> {
      if (!resource || typeof resource !== "object") {
        throw new ResourceReadError("undeclared");
      }
      const binding = bindings.get(resource);
      if (!binding) throw new ResourceReadError("undeclared");
      const existing = memo.get(resource);
      if (existing) return existing as Promise<T | null>;
      const pending = readBinding(binding, state.reads);
      memo.set(resource, pending);
      return pending as Promise<T | null>;
    },
  };
  registerPreparationResources(state);
  return Object.freeze(state);
}

/** Create a mediator with no declared resources. @internal */
export function emptyPreparationResources(): PreparationResources {
  return createPreparationResources({
    entries: [],
    requestInput: {},
  });
}

/** Return content-free pinned read facts for decision journaling. @internal */
export function preparationResourceReads(
  resources: PreparationResources,
): readonly PreparationResourceRead[] {
  const reads = (resources as Partial<PreparationResourceState>).reads;
  return Object.freeze([...(reads ?? [])]);
}

async function readBinding(
  binding: ResourceBinding,
  reads: PreparationResourceRead[],
): Promise<unknown | null> {
  let value: unknown | null;
  try {
    value = await binding.read();
  } catch (error) {
    if (error instanceof ResourceReadError) throw error;
    throw new ResourceReadError("storage-unavailable");
  }
  if (value === undefined) throw new ResourceReadError("unresolved");
  const valueHash = fingerprint(value);
  reads.push(
    Object.freeze({
      identity: binding.identity,
      revision: valueHash,
      valueHash,
    }),
  );
  return freezePlain(value);
}

function collectEntries(
  entries: readonly ContextEntry[],
  out: Map<object, ResourceBinding>,
  input: {
    readonly requestInput: Readonly<Record<string, unknown>>;
    readonly promptId?: string;
  },
  seen = new Set<object>(),
): void {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || seen.has(entry)) continue;
    seen.add(entry);
    const resource = entry as ResourceCandidate;
    if (resource[CONTROL_RESOURCE_RUNTIME]) bindDirect(resource, out);
    if (entry._tag === "Memory") bindMemory(entry, out, input);
    if (entry._tag === "ConditionalContext" && "context" in entry) {
      collectEntries([entry.context], out, input, seen);
    } else if (entry._tag === "MatchSpec" && "cases" in entry) {
      const branches = [
        ...Object.values(entry.cases).flatMap((branch) =>
          Array.isArray(branch) ? branch : [branch],
        ),
        ...(entry.default
          ? Array.isArray(entry.default)
            ? entry.default
            : [entry.default]
          : []),
      ];
      collectEntries(branches, out, input, seen);
    } else if (
      (entry._tag === "Context" || entry._tag === "Contributor") &&
      "useEntries" in entry
    ) {
      collectEntries(entry.useEntries, out, input, seen);
    } else if (isRepresentationLadder(entry)) {
      collectEntries(representationSources(entry), out, input, seen);
    }
  }
}

type ResourceCandidate = object & {
  readonly id?: string;
  readonly [CONTROL_RESOURCE_RUNTIME]?: ControlResourceRuntime<unknown>;
};

function bindDirect(
  resource: ResourceCandidate,
  out: Map<object, ResourceBinding>,
): void {
  const runtime = resource[CONTROL_RESOURCE_RUNTIME];
  if (!runtime) return;
  out.set(resource, {
    identity: `${runtime.kind}:${resource.id ?? "anonymous"}`,
    read: () => runtime.read(),
  });
}

function bindMemory(
  memory: object,
  out: Map<object, ResourceBinding>,
  input: {
    readonly requestInput: Readonly<Record<string, unknown>>;
    readonly promptId?: string;
  },
): void {
  const candidate = memory as {
    readonly id?: string;
    readonly blocks?: readonly ResourceCandidate[];
    readonly [CONTROL_RESOURCE_BINDER]?: (
      resource: ResourceCandidate,
      input: Readonly<Record<string, unknown>>,
      promptId?: string,
    ) => Promise<unknown | null>;
  };
  if (!candidate.blocks || !candidate[CONTROL_RESOURCE_BINDER]) return;
  for (const resource of candidate.blocks) {
    const runtime = resource[CONTROL_RESOURCE_RUNTIME];
    if (!runtime) continue;
    out.set(resource, {
      identity: `memory:${candidate.id ?? "anonymous"}:${resource.id ?? "anonymous"}`,
      read: () =>
        candidate[CONTROL_RESOURCE_BINDER]!(
          resource,
          input.requestInput,
          input.promptId,
        ),
    });
  }
}

function fingerprint(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return '"undefined"';
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function freezePlain<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezePlain(entry))) as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value))
    copy[key] = freezePlain(entry);
  return Object.freeze(copy) as T;
}
