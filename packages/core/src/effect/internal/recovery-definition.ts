/** Runtime-addressable recovery binding retained by an Effect definition. @internal @module */

import type {
  Awaitable,
  CapturedEffectRecoveryContext,
  EffectRecoveryContext,
} from "../types";
import type { RecoveryHandlerInvocation } from "./recovery-stack";

type EffectRecovery =
  | ((context: EffectRecoveryContext<unknown, unknown>) => Awaitable<void>)
  | {
      readonly execute: (
        context: CapturedEffectRecoveryContext<unknown, unknown, unknown>,
      ) => Awaitable<void>;
    };

/** Non-enumerable definition-owned recovery binding. */
export const effectRecoveryDefinition = "__cruxEffectRecoveryDefinition" as const;

/** Recoverable Effect definition with its private authored binding. */
export interface RuntimeAddressableEffectDefinition {
  readonly _tag: "EffectDefinition";
  readonly id: string;
  readonly version: number;
  readonly [effectRecoveryDefinition]: EffectRecovery;
}

/** Narrow an authored definition to the internal recovery binding contract. */
export function isRuntimeAddressableEffectDefinition(
  value: unknown,
): value is RuntimeAddressableEffectDefinition {
  return (
    typeof value === "function" &&
    (value as Partial<RuntimeAddressableEffectDefinition>)._tag ===
      "EffectDefinition" &&
    typeof (value as Partial<RuntimeAddressableEffectDefinition>).id ===
      "string" &&
    typeof (value as Partial<RuntimeAddressableEffectDefinition>).version ===
      "number" &&
    effectRecoveryDefinition in value
  );
}

/** Invoke the authored recovery binding with one retained occurrence. */
export async function invokeEffectRecoveryDefinition(
  definition: RuntimeAddressableEffectDefinition,
  invocation: RecoveryHandlerInvocation,
): Promise<void> {
  const recovery = definition[effectRecoveryDefinition];
  const context = {
    input: invocation.envelope.input,
    output: invocation.envelope.output,
    receipt: invocation.receipt,
    resource: invocation.resource,
    idempotencyKey: invocation.idempotencyKey,
    conflict: invocation.options?.conflict ?? "fail",
    signal: invocation.options?.signal,
  };
  if (typeof recovery === "function") {
    await recovery(context);
    return;
  }
  await recovery.execute({
    ...context,
    captured: invocation.envelope.captured,
  });
}
