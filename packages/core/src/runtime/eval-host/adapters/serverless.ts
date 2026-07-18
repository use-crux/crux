import { handleWakeRequest } from "../../handler/core";
import type { EvalHostStore } from "../types";
import type {
  CreateServerlessEvalHostOptions,
  ServerlessEvalHost,
} from "../types";
import { createResolvedEvalHost } from "../runtime";
import {
  assertEvalHostEntry,
  assertServerlessEvalHostRuntime,
  setupError,
} from "../setup";
import { normalizeRuntimeHandlerTargets } from "../../handler/targets";
import type { RuntimeTargetRuntimeRef } from "../../api/target-registry";

/** Create one request-safe generic-serverless Eval host binding. */
export function createServerlessEvalHost<TStore extends EvalHostStore>(
  options: CreateServerlessEvalHostOptions<TStore>,
): ServerlessEvalHost<TStore> {
  assertEvalHostEntry(options);
  assertServerlessEvalHostRuntime(options.runtime);
  const verify = options.verifyWake ?? options.runtime.verifyWakeRequest;
  if (verify === undefined) {
    throw setupError(
      "wake_unverified",
      "Configure an authenticated Runtime wake verifier before exposing the serverless Eval host.",
    );
  }
  const runtimeRef: RuntimeTargetRuntimeRef = {};
  const { targets: targetDeclarations = [], ...hostOptions } = options;
  const targets = normalizeRuntimeHandlerTargets({
    targets: targetDeclarations,
    runtimeRef,
    entry: "generated serverless Eval host",
  });
  const resolved = createResolvedEvalHost({
    ...hostOptions,
    targets,
    hostKind: "serverless",
    wakeMode: "durable",
  });
  runtimeRef.current = resolved.runtime;
  return Object.freeze({
    store: options.runtime.store,
    fetch: resolved.fetch,
    wake: (request: Request) =>
      handleWakeRequest(request, { runtime: resolved.runtime, verify }),
    dispose: () => resolved.runtime.dispose(),
  });
}
