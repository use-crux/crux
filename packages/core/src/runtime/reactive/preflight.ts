/**
 * Reactive Runtime capability preflight.
 *
 * @module
 */

import type { ResolvedRuntimeEngine } from "../api/create-runtime";
import { createRuntimeError } from "../engine/errors";
import { REACTIVE_CAPABILITY_CHECKS } from "./capabilities";
import {
  REACTIVE_CAPABILITY_PROFILES,
  type ReactiveCapabilityProfile,
} from "./capability-profiles";

interface ReactivePreflightInput {
  readonly profile: ReactiveCapabilityProfile;
  readonly runtime: ResolvedRuntimeEngine;
  readonly whatFailed: string;
}

/** Assert one reactive semantic guarantee against mechanical Runtime support. */
export function assertReactiveCapabilities(
  input: ReactivePreflightInput,
): void {
  const missing = REACTIVE_CAPABILITY_PROFILES[input.profile].requires.find(
    (capability) => !REACTIVE_CAPABILITY_CHECKS[capability](input.runtime),
  );
  if (!missing) return;
  const durabilityUnproven =
    missing === "storage.durable" &&
    input.runtime.store.durability === undefined;

  throw createRuntimeError({
    code: "CAPABILITY_MISSING",
    whatFailed: input.whatFailed,
    why:
      durabilityUnproven
        ? "The selected Runtime store does not declare durable Runtime storage, so restart-safe occurrence and delivery retention is unproven."
        : missing === "storage.durable"
        ? "The selected runtime uses process-local Runtime storage, so its occurrence and required delivery cannot survive restart."
        : missing === "signals.storage"
          ? "The selected durable Runtime store has no Signal storage, so it cannot atomically retain the occurrence and required delivery."
        : `The selected runtime is missing the mechanical capability \`${missing}\` required by \`${input.profile}\`.`,
    whatStillWorks:
      "Existing process-local Signal callbacks and ordinary local Flow signals still work.",
    nextStep:
      durabilityUnproven
        ? "Use a conformant store adapter that declares `durability: \"durable\"` and implements the optional `signals` port before starting this Flow."
        : missing === "storage.durable"
        ? "Provide durable Runtime storage, for example `node({ store: durableRuntimeStore })`, before starting this Flow."
        : missing === "signals.storage"
          ? "Use a durable Runtime store adapter that implements the optional `signals` port before starting this Flow."
        : `Choose or configure a Runtime adapter that provides \`${missing}\`, then retry the Flow.`,
  });
}
