/** V2 remote Eval cell submission, terminal mapping, and result decoding. */

import { TimeoutError } from "../../../generation/timeout";
import { fingerprintEvalValue } from "../../internal/identity";
import { getEvalDefinitionForInternalUse } from "../../internal/definition";
import type {
  EvalTaskHostRequest,
  EvalTaskHostResult,
} from "../../internal/types";
import { resolveEvalTimeoutPolicy } from "../../timeout-policy";
import type { HydratedEval } from "../cases";
import { decodeEvalHostResult } from "../../../runtime/eval-host/result-codec";
import {
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
} from "../../../runtime/eval-registry/projection";
import type { EvalHostReadiness } from "../../internal/types";
import type { resolveNodeEvalHostConnection } from "./connection";
import { pollEvalHostJobForInternalUse } from "./poll-job";
import { selectRemoteEvalDeadline } from "./remote-deadline";

type VerifiedRemote = Readonly<{
  readonly readiness: EvalHostReadiness;
  readonly connection?: Extract<
    Awaited<ReturnType<typeof resolveNodeEvalHostConnection>>,
    { status: "connected" }
  >;
}>;

/** Execute one planned cell through an already verified deployed Runtime. */
export async function executeRemoteEvalCell(
  entry: HydratedEval,
  request: EvalTaskHostRequest,
  resolved: VerifiedRemote,
): Promise<EvalTaskHostResult> {
  if (!resolved.connection || resolved.readiness.status !== "verified") {
    throw new TypeError("The selected deployed Runtime was not verified.");
  }
  const evalCase = entry.cases.find((item) => item.id === request.caseId);
  const variant = projectDeployedEvalVariants(entry.eval).find(
    (item) => item.name === request.variant,
  );
  if (!evalCase || !variant) {
    throw new TypeError("The planned remote Eval cell is stale.");
  }
  const identity = fingerprintEvalValue({
    eval: entry.definitionFingerprint,
    case: request.caseId,
    variant: request.variant,
    trial: request.trial,
    ...(request.executionAttemptId !== undefined
      ? { executionAttempt: request.executionAttemptId }
      : {}),
  });
  const deadline = selectRemoteEvalDeadline({
    nowMs: Date.now(),
    totalMs: resolveEvalTimeoutPolicy(
      getEvalDefinitionForInternalUse(entry.eval).timeout,
      evalCase.authored.timeout,
    ).totalMs,
  });
  const jobId = `job-${identity}`;
  const evalRunId = `run-${identity}`;
  const submitted = await resolved.connection.client.submit({
    protocol: "crux.eval-host.v2",
    jobId,
    evalRunId,
    evalId: entry.id,
    evalFingerprint: entry.definitionFingerprint,
    caseId: request.caseId,
    caseFingerprint: fingerprintDeployedEvalCase(
      entry.eval,
      evalCase.id,
      evalCase.authored,
    ),
    variant: request.variant,
    variantFingerprint: variant.fingerprint,
    trial: request.trial,
    deadlineAt: new Date(deadline.deadlineAtMs).toISOString(),
    deadline: {
      source: deadline.source,
      limitMs: deadline.limitMs,
    },
  });
  const status = await pollEvalHostJobForInternalUse(
    resolved.connection.client,
    submitted,
    deadline.deadlineAtMs,
  );
  if (
    deadline.source === "eval" &&
    (status.status === "expired" ||
      status.status === "accepted" ||
      status.status === "running")
  ) {
    const timeout =
      status.status === "expired"
        ? status.timeout
        : { budget: "total" as const, limitMs: deadline.limitMs };
    throw new TimeoutError({
      budget: timeout.budget,
      limitMs: timeout.limitMs,
      ...("toolName" in timeout && timeout.toolName !== undefined
        ? { toolName: timeout.toolName }
        : {}),
    });
  }
  if (status.status !== "succeeded") {
    const code =
      "error" in status ? status.error.code : "EVAL_HOST_POLL_TIMEOUT";
    throw new TypeError(`Deployed Eval execution failed (${code}).`);
  }
  return decodeEvalHostResult(status.result, { jobId, evalRunId });
}
