import type { Message } from "../generation/messages";
import type { MediaPartSubject } from "./boundary";
import type { GuardrailAudit, GuardrailContext } from "./guardrail/types";
import type { GuardrailBinding } from "./registry";
import type { Safety } from "./session-contract";
import { guardOutputMedia, type MediaOutputResult } from "./output/media";

export const outputMediaGuard: unique symbol = Symbol(
  "crux.safety.outputMediaGuard",
);
export const outputMediaEnforcement: unique symbol = Symbol(
  "crux.safety.outputMediaEnforcement",
);

/** Output-media methods mixed into the internal per-call Safety session. */
export interface SafetySessionMedia {
  readonly [outputMediaEnforcement]: boolean;
  [outputMediaGuard](
    subjects: readonly MediaPartSubject[],
    options?: {
      readonly minimumRetained?: number;
      readonly model?: string;
      readonly stream?:
        | GuardrailContext["stream"]
        | ((subject: MediaPartSubject) => GuardrailContext["stream"]);
    },
  ): Promise<MediaOutputResult>;
}

interface SafetySessionMediaState {
  readonly bindings: readonly GuardrailBinding[];
  readonly defaultModel?: string;
  readonly messages: () => readonly Message[];
  readonly context: (
    phase: "output",
    messages: readonly Message[],
  ) => GuardrailContext;
  readonly appendAudit: (audit: GuardrailAudit) => void;
}

/** Build the focused output-media portion of one internal Safety session. */
export function createSafetySessionMedia(
  state: SafetySessionMediaState,
): SafetySessionMedia {
  const bindings = state.bindings.filter(
    (binding) => binding.boundary.id === "model.output.media",
  );
  return {
    [outputMediaEnforcement]: bindings.some(
      (binding) => binding.mode === "enforce",
    ),
    [outputMediaGuard]: (subjects, options) =>
      guardOutputMedia({
        bindings,
        subjects,
        minimumRetained: options?.minimumRetained ?? 0,
        context: (subject) => ({
          ...state.context("output", state.messages()),
          model: options?.model ?? state.defaultModel,
          ...(options?.stream
            ? {
                stream:
                  typeof options.stream === "function"
                    ? options.stream(subject)
                    : options.stream,
              }
            : {}),
        }),
        appendAudit: state.appendAudit,
      }),
  };
}

/** @internal Guard canonical output media for Core-owned adapter projections. */
export function guardSafetySessionOutputMedia(
  safety: Safety,
  subjects: readonly MediaPartSubject[],
  options?: {
    readonly minimumRetained?: number;
    /** Selected provider model for routed completed-operation output. */
    readonly model?: string;
    /** Bounded-media occurrence provenance; completed operations omit it. */
    readonly stream?:
      | GuardrailContext["stream"]
      | ((subject: MediaPartSubject) => GuardrailContext["stream"]);
  },
): Promise<MediaOutputResult> {
  return (safety as Safety & SafetySessionMedia)[outputMediaGuard](
    subjects,
    options,
  );
}

/** @internal Whether exact output-media enforcement must defer byte release. */
export function safetyEnforcesOutputMedia(safety: Safety): boolean {
  return (safety as Safety & SafetySessionMedia)[outputMediaEnforcement];
}
