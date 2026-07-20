/** Total provider-neutral execution placement for authored Eval tasks. @internal */

import type { AnyEval } from "../evaluate";
import {
  resolveEvalArmForInternalUse,
  validateEvalVariantForInternalUse,
} from "./arm-policy";
import { getEvalDefinitionForInternalUse } from "./definition";
import {
  EvalTaskExecutionError,
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
} from "./task";

/** Coordinator or deployed-Runtime execution derived from one valid task. */
export interface ReadyEvalTaskExecutionProjection {
  readonly status: "ready";
  readonly execution: "coordinator" | "runtime";
  readonly requiredHostCapabilities: readonly string[];
}

/** Authored task value that cannot participate in execution planning. */
export interface InvalidEvalTaskExecutionProjection {
  readonly status: "invalid";
  readonly code:
    | "task_not_callable"
    | "task_contract_incompatible"
    | "variant_invalid";
  readonly reason: string;
}

/** Total task projection used by discovery, planning, and generation. */
export type EvalTaskExecutionProjection =
  | ReadyEvalTaskExecutionProjection
  | InvalidEvalTaskExecutionProjection;

/** One effective Eval arm plus its derived execution placement. */
export type EvalExecutionArmProjection =
  | Readonly<
      {
        readonly name: string;
        readonly fingerprint: string;
      } & ReadyEvalTaskExecutionProjection
    >
  | Readonly<{ readonly name: string } & InvalidEvalTaskExecutionProjection>;

/** Derive placement without treating an ordinary callable as an error. */
export function projectEvalTaskExecution(
  task: unknown,
): EvalTaskExecutionProjection {
  if (typeof task !== "function") {
    return Object.freeze({
      status: "invalid" as const,
      code: "task_not_callable" as const,
      reason: "Eval task must be callable.",
    });
  }
  try {
    if (!isManagedEvalTaskForInternalUse(task)) {
      return readyProjection([]);
    }
    const capabilities = Object.freeze(
      [
        ...new Set(
          getEvalTaskDescriptorForInternalUse(task).requiredHostCapabilities ??
            [],
        ),
      ].sort(compareCodepoint),
    );
    return readyProjection(capabilities);
  } catch (error) {
    if (
      error instanceof EvalTaskExecutionError &&
      error.code === "descriptor_incompatible"
    ) {
      return Object.freeze({
        status: "invalid" as const,
        code: "task_contract_incompatible" as const,
        reason: error.message,
      });
    }
    throw error;
  }
}

/** Validate one raw Variant and project its effective task without throwing. */
export function projectEvalVariantTaskExecution(
  baseTask: unknown,
  name: string,
  authored: Readonly<Record<string, unknown>>,
): EvalTaskExecutionProjection {
  try {
    validateEvalVariantForInternalUse(baseTask, name, authored);
  } catch (error) {
    const incompatible =
      error instanceof EvalTaskExecutionError &&
      error.code === "descriptor_incompatible";
    return Object.freeze({
      status: "invalid" as const,
      code: incompatible
        ? ("task_contract_incompatible" as const)
        : ("variant_invalid" as const),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return projectEvalTaskExecution(authored.task ?? baseTask);
}

/** Project Current first and Variants in their canonical effective order. */
export function projectEvalExecutionArms(
  evalValue: AnyEval,
): readonly EvalExecutionArmProjection[] {
  const definition = getEvalDefinitionForInternalUse(evalValue);
  return Object.freeze(
    definition.arms.map((declaration) => {
      const authored = definition.variants[declaration.name] ?? {};
      const execution = projectEvalVariantTaskExecution(
        definition.task,
        declaration.name,
        authored,
      );
      if (execution.status === "invalid") {
        return Object.freeze({ name: declaration.name, ...execution });
      }
      try {
        const arm = resolveEvalArmForInternalUse(definition, declaration.name);
        return Object.freeze({
          name: arm.name,
          fingerprint: arm.fingerprint,
          ...execution,
        });
      } catch (error) {
        const incompatible =
          error instanceof EvalTaskExecutionError &&
          error.code === "descriptor_incompatible";
        return Object.freeze({
          name: declaration.name,
          status: "invalid" as const,
          code: incompatible
            ? ("task_contract_incompatible" as const)
            : ("variant_invalid" as const),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

function readyProjection(
  capabilities: readonly string[],
): ReadyEvalTaskExecutionProjection {
  return Object.freeze({
    status: "ready" as const,
    execution: capabilities.length === 0 ? "coordinator" : "runtime",
    requiredHostCapabilities: capabilities,
  });
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
