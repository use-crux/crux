/**
 * Process-owned active prompt catalogue used by Runtime Bridge inspection.
 *
 * The slot stores immutable prompt identities and callbacks only in memory.
 * Publications are monotonic; a stale configuration cannot retire or
 * resurrect a newer catalogue.
 *
 * @module
 */

import type {
  PromptPreviewTarget,
  StrictJsonValue,
} from "../runtime-bridge/prompt-preview/protocol";
import { getCruxProcessRegistry } from "./process-registry";
import type {
  ActivePromptCatalogue,
  ActivePromptCatalogueEntry,
  PromptCatalogueListener,
} from "./prompt-catalogue-state";

export type {
  ActivePromptCatalogue,
  ActivePromptCatalogueEntry,
  PromptCatalogueListener,
} from "./prompt-catalogue-state";

/** Opaque ownership token returned to one successful public configuration. */
export interface PromptCatalogueOwner {
  readonly token: number;
}

/** Return the current immutable catalogue without retaining a mutable registry. */
export function activePromptCatalogue(): ActivePromptCatalogue {
  return getCruxProcessRegistry().promptCatalogue.current;
}

/**
 * Atomically publish one successfully configured prompt catalogue.
 *
 * @param entries - Validated, frozen prompt targets and their canonical runtime callbacks.
 * @returns Ownership token whose retirement is effective only while it remains active.
 */
export function publishPromptCatalogue(
  entries: readonly ActivePromptCatalogueEntry[],
): PromptCatalogueOwner {
  const slot = getCruxProcessRegistry().promptCatalogue;
  const token = nextSafeInteger(slot.nextOwnerToken, "prompt catalogue owner");
  const revision = nextSafeInteger(
    slot.current.revision,
    "prompt catalogue revision",
  );
  slot.nextOwnerToken = token;
  slot.activeOwnerToken = token;
  slot.current = freezeCatalogue(revision, entries);
  notify(slot.listeners, slot.current);
  return Object.freeze({ token });
}

/**
 * Publish an empty catalogue when `owner` still identifies the active config.
 *
 * Stale disposal is deliberately a no-op, preventing an older registry from
 * retiring a replacement installed later in the same process.
 */
export function retirePromptCatalogue(owner: PromptCatalogueOwner): void {
  const slot = getCruxProcessRegistry().promptCatalogue;
  if (slot.activeOwnerToken !== owner.token) return;
  const revision = nextSafeInteger(
    slot.current.revision,
    "prompt catalogue revision",
  );
  slot.activeOwnerToken = 0;
  slot.current = freezeCatalogue(revision, []);
  notify(slot.listeners, slot.current);
}

/**
 * Observe complete catalogue replacements until explicitly unsubscribed.
 *
 * @param listener - Synchronous listener that must not mutate the publication.
 * @returns Idempotent unsubscribe function.
 */
export function subscribePromptCatalogue(
  listener: PromptCatalogueListener,
): () => void {
  const listeners = getCruxProcessRegistry().promptCatalogue.listeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function freezeCatalogue(
  revision: number,
  entries: readonly ActivePromptCatalogueEntry[],
): ActivePromptCatalogue {
  return Object.freeze({
    revision,
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          prompt: entry.prompt,
          target: freezeTarget(entry.target),
        }),
      ),
    ),
  });
}

function freezeTarget(target: PromptPreviewTarget): PromptPreviewTarget {
  if (target.input.mode !== "schema") {
    return Object.freeze({
      ...target,
      input: Object.freeze({ ...target.input }),
    });
  }
  return Object.freeze({
    ...target,
    input: Object.freeze({
      mode: "schema",
      schema: freezeJsonObject(target.input.schema),
    }),
  });
}

function freezeJsonObject(
  value: Readonly<Record<string, StrictJsonValue>>,
): Readonly<Record<string, StrictJsonValue>> {
  for (const child of Object.values(value)) freezeJsonValue(child);
  return Object.freeze(value);
}

function freezeJsonValue(value: StrictJsonValue): void {
  if (isJsonArray(value)) {
    for (const child of value) freezeJsonValue(child);
    Object.freeze(value);
    return;
  }
  if (value && typeof value === "object") {
    freezeJsonObject(value);
  }
}

function isJsonArray(
  value: StrictJsonValue,
): value is readonly StrictJsonValue[] {
  return Array.isArray(value);
}

function notify(
  listeners: ReadonlySet<PromptCatalogueListener>,
  catalogue: ActivePromptCatalogue,
): void {
  for (const listener of listeners) {
    try {
      listener(catalogue);
    } catch {
      // Publication is authoritative even when one transport listener fails.
    }
  }
}

function nextSafeInteger(current: number, label: string): number {
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error(`Invalid ${label} state.`);
  }
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} exhausted.`);
  }
  return current + 1;
}
