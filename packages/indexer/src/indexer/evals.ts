import type { ProjectDefinition } from "@use-crux/core/project-index";
import {
  projectEvalTaskExecution,
  type EvalTaskExecutionProjection,
} from "@use-crux/core/runtime/internal/eval-registry";
import { definition, safeId } from "./definitions";

/** Inert Eval handle shape visible to runtime-rich Project Index discovery. */
export interface DiscoveredAuthoredEval {
  readonly _tag: "CruxEval";
  readonly id?: string;
}

/** Runtime-rich placement projected from one authored Current or Variant arm. */
export type AuthoredEvalExecutionArm = Readonly<
  { readonly name: string } & EvalTaskExecutionProjection
>;

const EVAL_DEFINITION_SYMBOL_DESCRIPTION = "crux.eval.definition";
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
  executionArms: readonly AuthoredEvalExecutionArm[],
): Promise<ProjectDefinition> {
  const name = evalValue.id ?? derivedEvalId(root, file);
  const readyArms = executionArms.flatMap((arm) =>
    arm.status === "ready"
      ? [
          Object.freeze({
            name: arm.name,
            execution: arm.execution,
            requiredHostCapabilities: arm.requiredHostCapabilities,
          }),
        ]
      : [],
  );
  const requiredHostCapabilities = runtimeCapabilityUnion(executionArms);
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
      evalExecutionArms: readyArms,
      facts: {
        kind: "eval",
        evalContract: "crux.eval",
        requiredHostCapabilities,
        evalExecutionArms: readyArms,
      },
    },
  );
}

/** Project every effective arm using Core's shared total task classifier. */
export function executionArmsFromAuthoredEval(
  evalValue: DiscoveredAuthoredEval,
): readonly AuthoredEvalExecutionArm[] {
  const definitionSymbol = Object.getOwnPropertySymbols(evalValue).find(
    (symbol) => symbol.description === EVAL_DEFINITION_SYMBOL_DESCRIPTION,
  );
  const definition = definitionSymbol
    ? (evalValue as unknown as Record<PropertyKey, unknown>)[definitionSymbol]
    : undefined;
  if (!isRecord(definition) || definition.schemaVersion !== 1) {
    return Object.freeze([]);
  }
  const variants = isRecord(definition.variants) ? definition.variants : {};
  const names = Object.freeze([
    "current",
    ...Object.keys(variants).sort(compareCodepoint),
  ]);
  return Object.freeze(
    names.map((name) => {
      const variant = name === "current" ? undefined : variants[name];
      const task = isRecord(variant) && "task" in variant
        ? variant.task
        : definition.task;
      return Object.freeze({ name, ...projectEvalTaskExecution(task) });
    }),
  );
}

function runtimeCapabilityUnion(
  arms: readonly AuthoredEvalExecutionArm[],
): readonly string[] {
  return Object.freeze(
    [...new Set(
      arms.flatMap((arm) =>
        arm.status === "ready" && arm.execution === "runtime"
          ? arm.requiredHostCapabilities
          : [],
      ),
    )]
      .filter((value) => REQUIRED_HOST_CAPABILITIES.has(value))
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
