/** Pure Variant selection, effective-task resolution, and blocking policy. @internal */

import type { EvalDefinitionV1 } from "./definition";
import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import type { EvalPlannedArm } from "./types";

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
          overrides,
          authored.task !== undefined,
        ),
        blocking:
          declaration.name === "current" || declaration.name === selector,
      });
    }),
  );
}

function armFingerprint(
  evalId: string,
  name: string,
  overrideKeys: readonly string[],
  overrides: Readonly<Record<string, unknown>>,
  replacesTask: boolean,
): string {
  return fingerprintEvalValue({
    evalId,
    name,
    overrideKeys,
    overrides: isReusableEvalValue(overrides) ? overrides : "unavailable",
    replacesTask,
  });
}

const EMPTY_OVERRIDES = Object.freeze({});
