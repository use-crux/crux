import type { ProjectDefinition } from "@use-crux/core/project-index";
import { definition, safeId } from "./definitions";

/** Inert Eval handle shape visible to runtime-rich Project Index discovery. */
export interface DiscoveredAuthoredEval {
  readonly _tag: "CruxEval";
  readonly id?: string;
}

const EVAL_DEFINITION_SYMBOL_DESCRIPTION = "crux.eval.definition";
const EVAL_TASK_DESCRIPTOR = Symbol.for("@use-crux/core/eval/task-descriptor");
const REQUIRED_HOST_CAPABILITIES = new Set([
  "asset-store",
  "record-store",
  "vector-store",
]);

/** Identify an inert Eval without reading callbacks, schemas, or tasks. */
export function isAuthoredEval(
  value: unknown,
): value is DiscoveredAuthoredEval {
  return (
    value !== null &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "CruxEval"
  );
}

/** Build safe Project Index corroboration for a deployed Eval. */
export async function definitionFromAuthoredEval(
  root: string,
  file: string,
  exportName: string,
  evalValue: DiscoveredAuthoredEval,
  requiredHostCapabilities: readonly string[],
): Promise<ProjectDefinition> {
  const name = evalValue.id ?? derivedEvalId(root, file);
  return definition(
    root,
    file,
    `eval:${safeId(name)}`,
    "eval",
    name,
    undefined,
    {
      exportName,
      evalContract: "crux.eval",
      explicitId: evalValue.id !== undefined,
      requiredHostCapabilities,
      facts: {
        kind: "eval",
        evalContract: "crux.eval",
        requiredHostCapabilities,
      },
    },
  );
}

/** Read only the allowlisted deployment requirements from an inert Eval. */
export function requiredHostCapabilitiesFromAuthoredEval(
  evalValue: DiscoveredAuthoredEval,
): readonly string[] {
  const definitionSymbol = Object.getOwnPropertySymbols(evalValue).find(
    (symbol) => symbol.description === EVAL_DEFINITION_SYMBOL_DESCRIPTION,
  );
  const definition = definitionSymbol
    ? (evalValue as unknown as Record<PropertyKey, unknown>)[definitionSymbol]
    : undefined;
  if (!isRecord(definition) || definition.schemaVersion !== 1) return [];
  const task = definition.task;
  if (typeof task !== "function") return [];
  const descriptor = (task as unknown as Record<PropertyKey, unknown>)[
    EVAL_TASK_DESCRIPTOR
  ];
  if (
    !isRecord(descriptor) ||
    !Array.isArray(descriptor.requiredHostCapabilities)
  ) {
    return [];
  }
  return Object.freeze(
    [...new Set(descriptor.requiredHostCapabilities)]
      .filter(
        (value): value is string =>
          typeof value === "string" && REQUIRED_HOST_CAPABILITIES.has(value),
      )
      .sort(compareCodepoint),
  );
}

function derivedEvalId(root: string, file: string): string {
  const relativeFile = file
    .slice(root.length)
    .replace(/^[/\\]/, "")
    .replace(/\\/g, "/");
  const beneathEvals = relativeFile.startsWith("evals/")
    ? relativeFile.slice("evals/".length)
    : relativeFile;
  return beneathEvals.replace(/\.eval\.[cm]?[jt]sx?$/, "").replaceAll("/", ".");
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object";
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
