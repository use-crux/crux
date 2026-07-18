/** Pure inline Case identity, validation, and trial expansion inputs. @internal */

import type { EvalDefinitionV1, RawEvalCase } from "./definition";
import { fingerprintEvalValue } from "./identity";

export interface ResolvedInlineCase {
  readonly caseId: string;
  readonly authored: RawEvalCase;
  readonly trials: number;
}

/** Resolve stable Case IDs and reject duplicate identities before any work. */
export function resolveInlineCases(
  definition: EvalDefinitionV1,
): readonly ResolvedInlineCase[] {
  assertTrials(definition.trials, "Eval");
  if (definition.cases.length === 0) {
    throw new TypeError("planEval(): at least one Case is required.");
  }
  const seen = new Map<string, number>();
  return Object.freeze(
    definition.cases.map((authored, index) => {
      const caseId = authored.id ?? fingerprintEvalValue(authored.input);
      const previous = seen.get(caseId);
      if (previous !== undefined) {
        throw new TypeError(
          `planEval(): duplicate Case id '${caseId}' at inline Cases ${previous + 1} and ${index + 1}.`,
        );
      }
      seen.set(caseId, index);
      const trials = authored.trials ?? definition.trials;
      assertTrials(trials, `Case '${caseId}'`);
      return Object.freeze({ caseId, authored, trials });
    }),
  );
}

function assertTrials(value: number, source: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${source} trials must be a positive integer.`);
  }
}
