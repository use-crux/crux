/**
 * Authenticated resolver handoff for boundary-pinned preparation resources.
 *
 * @internal
 * @module
 */

import type {
  ControlReadable,
  PreparationResources,
} from "./resources";

/** Resolver-private input key preserved across schema parsing. @internal */
export const PREPARATION_RESOURCES_INPUT =
  "_crux_preparationResources";

const authenticated = new WeakSet<object>();
const AUTHENTICATION = Symbol("preparation-resources");
const AUTHENTICATION_TOKEN = Object.freeze({});

/** Register a Core-created resource mediator as resolver-readable. @internal */
export function registerPreparationResources(
  resources: PreparationResources,
): void {
  authenticated.add(resources);
  Object.defineProperty(resources, AUTHENTICATION, {
    value: AUTHENTICATION_TOKEN,
  });
}

/** Attach a mediator to the resolver-private input channel. @internal */
export function withPreparationResourcesInput<T extends object>(
  options: T,
  resources: PreparationResources,
): T {
  const input =
    "input" in options &&
    options.input &&
    typeof options.input === "object" &&
    !Array.isArray(options.input)
      ? (options.input as Record<string, unknown>)
      : {};
  return {
    ...options,
    input: {
      ...input,
      [PREPARATION_RESOURCES_INPUT]: resources,
    },
  } as T;
}

/** Read through an authenticated mediator embedded in resolver input. @internal */
export function readPinnedPreparationResource<T>(
  input: unknown,
  resource: ControlReadable<T>,
): Promise<T | null> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const resources = (input as Record<string, unknown>)[
    PREPARATION_RESOURCES_INPUT
  ];
  const authenticatedProxy =
    !!resources &&
    typeof resources === "object" &&
    (resources as Record<PropertyKey, unknown>)[AUTHENTICATION] ===
      AUTHENTICATION_TOKEN;
  return resources &&
    typeof resources === "object" &&
    (authenticated.has(resources) || authenticatedProxy)
    ? (resources as PreparationResources).read(resource)
    : undefined;
}
