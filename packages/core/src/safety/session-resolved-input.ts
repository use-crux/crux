/** Private bridge from resolved prompt provenance to a Safety session. */

import type { ResolvedPrompt } from "../resolver/types";
import type { ResolvedSystemIngressCarrier } from "../resolver/system-ingress-provenance";
import { systemIngressCarrierFor } from "../resolver/system-ingress-provenance";
import type { Safety } from "./session-contract";
import { resolvedInputGuard, type SafetySession } from "./session-bridge";

type SafetyInput = Parameters<SafetySession[typeof resolvedInputGuard]>[0];
type SafetyInputResult = ReturnType<SafetySession[typeof resolvedInputGuard]>;

/** Whether the active transcript came from this exact resolved prompt. */
export interface ResolvedInputDelivery {
  readonly resolvedMessages: "selected" | "discarded";
}

/** @internal Guard resolved input with its non-serializable provenance. */
export function guardSafetySessionResolvedInput(
  safety: Safety,
  resolved: ResolvedPrompt,
  input: SafetyInput,
  delivery: ResolvedInputDelivery,
): SafetyInputResult {
  const carrier = systemIngressCarrierFor(resolved);
  return (safety as SafetySession)[resolvedInputGuard](
    input,
    carrier?.mode === "messages" && delivery.resolvedMessages === "discarded"
      ? undefined
      : carrier,
    "full",
  );
}

/** @internal Guard only resolver-owned blocks for one amendment. */
export function guardSafetySessionIngressCarrier(
  safety: Safety,
  carrier: ResolvedSystemIngressCarrier,
  input: SafetyInput,
): SafetyInputResult {
  return (safety as SafetySession)[resolvedInputGuard](
    input,
    carrier,
    "carrier",
  );
}
