import type { GuardrailContext } from "../../../safety/guardrail/types";

/** Build callback provenance for one bounded-media Safety occurrence. */
export function streamingMediaGuardContext(
  phase: "preview" | "final",
  outputIndex: number,
  sequence?: number,
): NonNullable<GuardrailContext["stream"]> {
  return Object.freeze({
    segment: true,
    last: phase === "final",
    heldChars: 0,
    heldMs: 0,
    media: Object.freeze({
      phase,
      outputIndex,
      ...(sequence === undefined ? {} : { sequence }),
    }),
  });
}
