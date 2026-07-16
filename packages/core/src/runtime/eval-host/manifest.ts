import { RUNTIME_RESULT_MAX_BYTES } from "../results/types";
import type { DeployedEvalRegistry } from "../eval-registry";
import {
  CRUX_EVAL_HOST_PROTOCOL,
  type EvalHostKind,
  type EvalHostManifestV1,
} from "./types";

/** Project the generated allowlist into the privacy-safe host manifest. */
export function createEvalHostManifest(input: {
  readonly deploymentId: string;
  readonly hostKind: EvalHostKind;
  readonly registry: DeployedEvalRegistry;
}): EvalHostManifestV1 {
  return Object.freeze({
    protocol: CRUX_EVAL_HOST_PROTOCOL,
    deploymentId: input.deploymentId,
    hostKind: input.hostKind,
    capabilities: Object.freeze(["result-ref"]),
    resultMaxBytes: RUNTIME_RESULT_MAX_BYTES,
    evals: Object.freeze(
      [...input.registry.entries]
        .sort((left, right) => compareCodepoint(left.id, right.id))
        .map((entry) =>
          Object.freeze({
            id: entry.id,
            evalFingerprint: entry.evalFingerprint,
            cases: identityRecord(entry.cases),
            variants: identityRecord(entry.variants),
            requiredHostCapabilities: Object.freeze(
              [...entry.requiredHostCapabilities].sort(compareCodepoint),
            ),
          }),
        ),
    ),
  });
}

function identityRecord(
  entries: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly fingerprint: string;
  }[],
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      entries
        .map((entry) => [entry.id ?? entry.name!, entry.fingerprint] as const)
        .sort(([left], [right]) => compareCodepoint(left, right)),
    ),
  );
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
