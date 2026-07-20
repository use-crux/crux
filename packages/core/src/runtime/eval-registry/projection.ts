import type { AnyEval } from "../../eval/evaluate";
import { resolveEvalArms } from "../../eval/internal/arm-policy";
import type { RawEvalCase } from "../../eval/internal/definition";
import {
  fingerprintEvalValue,
  isReusableEvalValue,
} from "../../eval/internal/identity";
import { getEvalDefinitionForInternalUse } from "../../eval/internal/definition";
import { EvalTaskExecutionError } from "../../eval/internal/task";
import { projectEvalExecutionArms } from "../../eval/internal/execution-placement";
export {
  projectEvalExecutionArms,
  projectEvalTaskExecution,
} from "../../eval/internal/execution-placement";
export type {
  EvalExecutionArmProjection,
  EvalTaskExecutionProjection,
  InvalidEvalTaskExecutionProjection,
  ReadyEvalTaskExecutionProjection,
} from "../../eval/internal/execution-placement";

/** Fingerprint one deployed Case without diagnostic-only metadata. */
export function fingerprintDeployedEvalCase(
  id: string,
  authored: RawEvalCase,
): string {
  if (
    !isReusableEvalValue(authored.input) ||
    (authored.call !== undefined && !isReusableEvalValue(authored.call))
  ) {
    throw new TypeError(
      `Deployed Eval Case '${id}' contains dynamic or non-durable input/call data.`,
    );
  }
  return fingerprintEvalValue({
    id,
    input: authored.input,
    ...(authored.call !== undefined ? { call: authored.call } : {}),
    ...(authored.expected !== undefined ? { expected: authored.expected } : {}),
    ...(authored.unvalidatedExpected === true
      ? { unvalidatedExpected: true }
      : {}),
    ...(authored.trials !== undefined ? { trials: authored.trials } : {}),
    ...(authored.tags !== undefined ? { tags: authored.tags } : {}),
    ...(authored.skip !== undefined ? { skip: authored.skip } : {}),
    ...(authored.only !== undefined ? { only: authored.only } : {}),
  });
}

/** Project the exact Current and Variant fingerprints used by planning. */
export function projectDeployedEvalVariants(
  evalValue: AnyEval,
): readonly Readonly<{ name: string; fingerprint: string }>[] {
  return Object.freeze(
    resolveEvalArms(getEvalDefinitionForInternalUse(evalValue)).map((arm) =>
      Object.freeze({ name: arm.name, fingerprint: arm.fingerprint }),
    ),
  );
}

/** Project allowlisted durable services from every effective managed task. */
export function projectDeployedEvalRequiredHostCapabilities(
  evalValue: AnyEval,
): readonly string[] {
  const arms = projectEvalExecutionArms(evalValue);
  const invalid = arms.find((arm) => arm.status === "invalid");
  if (invalid !== undefined) {
    throw new EvalTaskExecutionError(
      "descriptor_incompatible",
      invalid.reason,
    );
  }
  const capabilities = arms.flatMap((arm) =>
    arm.status === "ready" && arm.execution === "runtime"
      ? arm.requiredHostCapabilities
      : [],
  );
  return Object.freeze([...new Set(capabilities)].sort(compareCodepoint));
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
