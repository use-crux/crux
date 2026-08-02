/** Static Signal Flow activation preflight. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { runtimeRequiredError } from "../runtime/api/runtime-required";
import { assertReactiveCapabilities } from "../runtime/reactive/preflight";
import type { FlowSignalMap } from "./signals";
import { staticSignalSourceIds } from "./static-signal-sources";

interface StaticSignalFlowActivationInput {
  readonly flowName: string;
  readonly signals: FlowSignalMap | undefined;
  readonly runtime?: ResolvedRuntimeEngine;
}

/** Reject unsupported static Signal bindings before Flow work begins. */
export function assertStaticSignalFlowActivation(
  input: StaticSignalFlowActivationInput,
): void {
  const [signalId] = staticSignalSourceIds(input.signals);
  if (!signalId) return;
  if (!input.runtime) {
    throw runtimeRequiredError({ api: "flow.waitFor()" });
  }
  assertReactiveCapabilities({
    profile: "signal.durable-delivery",
    runtime: input.runtime,
    whatFailed: `Flow \`${input.flowName}\` cannot activate durable Signal wait \`${signalId}\`.`,
  });
}
