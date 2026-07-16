import type { InProcessRuntimeEngineDefinition } from "../api/runtime-definition";
import type { CreateEvalHostOptions, EvalHostStore } from "./types";

/** Stable configuration failures raised before an Eval host binds routes. */
export type EvalHostSetupErrorCode =
  | "store_missing"
  | "wake_missing"
  | "result_store_missing"
  | "entry_missing"
  | "token_missing"
  | "token_invalid"
  | "durable_store_required"
  | "wake_unverified";

/** Actionable private host setup failure. */
export class EvalHostSetupError extends Error {
  override readonly name = "EvalHostSetupError";

  constructor(
    readonly code: EvalHostSetupErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Validate protocol credentials and the generated deployed-Eval entry. */
export function assertEvalHostEntry(
  options: Partial<CreateEvalHostOptions>,
): asserts options is CreateEvalHostOptions {
  if (options.token === undefined || options.token.length === 0) {
    throw setupError(
      "token_missing",
      "Configure the dedicated Eval-execute bearer capability before exposing the host.",
    );
  }
  if (options.token.length < 32) {
    throw setupError(
      "token_invalid",
      "Use an Eval-execute bearer capability containing at least 32 characters.",
    );
  }
  if (
    options.registry === undefined ||
    !Array.isArray(options.registry.entries)
  ) {
    throw setupError(
      "entry_missing",
      "Import the generated deployed Eval registry in the Runtime host entry.",
    );
  }
}

/** Validate the concrete store capability required by normalized results. */
export function assertEvalHostStore(
  store: EvalHostStore | undefined,
): asserts store is EvalHostStore {
  if (store === undefined) {
    throw setupError(
      "store_missing",
      "Configure a Runtime store before creating the Eval host.",
    );
  }
  if (store.results === undefined) {
    throw setupError(
      "result_store_missing",
      "Configure durable Runtime result payload storage before creating the Eval host.",
    );
  }
}

/** Validate durable generic-serverless execution and wake delivery. */
export function assertServerlessEvalHostRuntime(
  runtime: InProcessRuntimeEngineDefinition<EvalHostStore> | undefined,
): asserts runtime is InProcessRuntimeEngineDefinition<EvalHostStore> {
  if (runtime?.store === undefined) {
    throw setupError(
      "store_missing",
      "Configure a durable Runtime store in serverless() before creating the Eval host.",
    );
  }
  if (typeof runtime.createWake !== "function") {
    throw setupError(
      "wake_missing",
      "Configure a durable Runtime wake adapter in serverless() before creating the Eval host.",
    );
  }
  assertEvalHostStore(runtime.store);
  if (runtime.store.id === "memory") {
    throw setupError(
      "durable_store_required",
      "The process-local memory store cannot preserve serverless Eval jobs; configure a durable Runtime store.",
    );
  }
}

/** Create one coded preflight error without leaking configuration values. */
export function setupError(
  code: EvalHostSetupErrorCode,
  message: string,
): EvalHostSetupError {
  return new EvalHostSetupError(code, message);
}
