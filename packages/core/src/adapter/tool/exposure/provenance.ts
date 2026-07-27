/**
 * Private provider-exposure provenance carried through tool wrappers.
 *
 * @internal
 * @module
 */

import type { ToolExposureProvenance } from "./types";

const toolExposureProvenance: unique symbol = Symbol(
  "crux.toolExposureProvenance",
);

/**
 * Return a shallow tool clone carrying immutable discovery provenance.
 *
 * The enumerable symbol survives the lifecycle's existing object-spread
 * wrappers without adding a public string-keyed tool field.
 */
export function withToolExposureProvenance<TTool>(
  tool: TTool,
  provenance: ToolExposureProvenance,
): TTool {
  if (typeof tool !== "object" || tool === null) return tool;
  const clone = Object.create(
    Object.getPrototypeOf(tool),
    Object.getOwnPropertyDescriptors(tool),
  ) as TTool;
  Object.defineProperty(clone, toolExposureProvenance, {
    value: Object.freeze({ ...provenance }),
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return clone;
}

/** Read winning exposure provenance, defaulting ordinary tools to authored. */
export function readToolExposureProvenance(
  tool: unknown,
): ToolExposureProvenance {
  if (typeof tool !== "object" || tool === null) return { kind: "authored" };
  return (
    (tool as {
      readonly [toolExposureProvenance]?: ToolExposureProvenance;
    })[toolExposureProvenance] ?? { kind: "authored" }
  );
}
