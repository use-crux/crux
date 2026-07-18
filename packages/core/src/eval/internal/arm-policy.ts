/** Pure Variant selection, effective-task resolution, and blocking policy. @internal */

import type { EvalDefinitionV1 } from "./definition";
import { fingerprintEvalValue } from "./identity";
import type { EvalPlannedArm } from "./types";
import {
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
  projectEvalTaskIdentityForInternalUse,
} from "./task";

/** Resolve Current first, followed by selected candidates in declaration order. */
export function resolveEvalArms(
  definition: EvalDefinitionV1,
  selector?: string,
): readonly EvalPlannedArm[] {
  if (selector === "baseline") {
    throw new TypeError(
      "planEval(): Variant selector 'baseline' is reserved and is not an authored Variant.",
    );
  }
  if (
    selector !== undefined &&
    selector !== "current" &&
    !Object.prototype.hasOwnProperty.call(definition.variants, selector)
  ) {
    throw new TypeError(`planEval(): unknown Variant selector '${selector}'.`);
  }
  const declarations =
    selector === undefined
      ? definition.arms
      : selector === "current"
        ? definition.arms.slice(0, 1)
        : definition.arms.filter(
            (arm) => arm.name === "current" || arm.name === selector,
          );
  return Object.freeze(
    declarations.map((declaration) => {
      const authored = definition.variants[declaration.name] ?? EMPTY_OVERRIDES;
      validateVariant(definition.task, declaration.name, authored);
      const task = authored.task ?? definition.task;
      const { task: _task, ...adapterOverrides } = authored;
      const overrides = Object.freeze(adapterOverrides);
      return Object.freeze({
        name: declaration.name,
        task,
        overrides,
        overrideKeys: declaration.overrideKeys,
        fingerprint: armFingerprint(
          definition.explicitId ?? "(path-derived)",
          declaration.name,
          declaration.overrideKeys,
          task,
          overrides,
          authored.task !== undefined,
        ),
        blocking:
          declaration.name === "current" || declaration.name === selector,
      });
    }),
  );
}

function validateVariant(
  baseTask: unknown,
  name: string,
  authored: Readonly<Record<string, unknown>>,
): void {
  if (!isManagedEvalTaskForInternalUse(baseTask)) {
    const fieldOverrides = Object.keys(authored).filter(
      (key) => key !== "task",
    );
    if (fieldOverrides.length > 0) {
      throw new TypeError(
        `planEval(): Variant '${name}' cannot apply field overrides (${fieldOverrides.join(", ")}) to an opaque task. Use a managed Eval task or replace the task explicitly.`,
      );
    }
    return;
  }
  const baseDescriptor = getEvalTaskDescriptorForInternalUse(baseTask);
  baseDescriptor.validateVariantOverrides?.(authored);
  if (authored.task === undefined) return;
  if (!isManagedEvalTaskForInternalUse(authored.task)) {
    throw new TypeError(
      `planEval(): Variant '${name}' must replace a managed task with another managed Eval task.`,
    );
  }
  const replacement = getEvalTaskDescriptorForInternalUse(authored.task);
  if (replacement.adapterId !== baseDescriptor.adapterId) {
    throw new TypeError(
      `planEval(): Variant '${name}' uses an incompatible task adapter.`,
    );
  }
  if (
    replacement.operation !== baseDescriptor.operation ||
    replacement.callContractFingerprint === undefined ||
    baseDescriptor.callContractFingerprint === undefined ||
    replacement.callContractFingerprint !==
      baseDescriptor.callContractFingerprint
  ) {
    throw new TypeError(
      `planEval(): Variant '${name}' replacement task has an incompatible call contract.`,
    );
  }
  if (
    (replacement.outputSchema === undefined) !==
    (baseDescriptor.outputSchema === undefined)
  ) {
    throw new TypeError(
      `planEval(): Variant '${name}' replacement task must preserve text or structured output mode.`,
    );
  }
  if (
    baseDescriptor.outputSchema !== undefined &&
    replacement.outputContractFingerprint !==
      baseDescriptor.outputContractFingerprint
  ) {
    throw new TypeError(
      `planEval(): Variant '${name}' replacement task has an incompatible structured output schema.`,
    );
  }
  replacement.validateVariantOverrides?.(authored);
}

function armFingerprint(
  evalId: string,
  name: string,
  overrideKeys: readonly string[],
  task: unknown,
  overrides: Readonly<Record<string, unknown>>,
  replacesTask: boolean,
): string {
  const projection = isManagedEvalTaskForInternalUse(task)
    ? projectEvalTaskIdentityForInternalUse(task, {
        phase: "plan",
        input: null,
        overrides,
      })
    : undefined;
  return fingerprintEvalValue({
    evalId,
    name,
    overrideKeys,
    projection:
      projection?.reusable === true
        ? projection.fingerprintMaterial
        : { unavailable: projection?.reason ?? "opaque_task" },
    replacesTask,
  });
}

const EMPTY_OVERRIDES = Object.freeze({});
