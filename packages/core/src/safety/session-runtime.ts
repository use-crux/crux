/**
 * Runtime composition for one Safety call.
 *
 * Registry, constraint, stream, and method concerns stay behind focused
 * modules; this file snapshots runtime hooks and wires their shared state.
 *
 * @module
 */

import type { Message } from "../generation/messages";
import { getHooks } from "../runtime/runtime";
import type { z } from "zod";
import type { BoundaryDef } from "./boundary";
import { buildSafetyRegistry, type GuardrailBinding } from "./registry";
import type { SafetyBindingApplicability } from "./applicability";
import {
  disabledBindingEntries,
  dormantBindingEntries,
  recordBindingAuditEntries,
} from "./binding-audit";
import type { Constraint, ConstraintContext } from "./constraint/types";
import type { GuardrailAudit, GuardrailContext } from "./guardrail/types";
import { createSafetyStream } from "./stream/engine";
import { failClosedOnRejection } from "./stream/fail-closed";
import { finalizeLanguageTerminal } from "./output/terminal";
import type {
  OperationInputGuardContext,
  StructuredSafetyContext,
} from "./session-bridge";
import type { ModelInputOrigin } from "./input-origin";
import type {
  Safety,
  SafetyCallOptions,
  SafetyContext,
  SafetyOutput,
  SafetyProtocolEvent,
  SafetyStream,
} from "./session-contract";
export { defaultConstraintFeedbackFormatter } from "./session-feedback";
import { defaultConstraintFeedbackFormatter } from "./session-feedback";
import {
  constraintsForMode,
  enabledGuardrailBindings,
} from "./session-bindings";
import { createSessionConstraintRunner } from "./session-constraints";
import { createSafetySessionMethods } from "./session-methods";
import { createScopedSafetySession } from "./scope-session";

// ─────────────────────────────────────────────────────────────────
// createSafety
// ─────────────────────────────────────────────────────────────────

/**
 * Create the per-call safety session.
 *
 * Reads runtime globals once at creation and
 * snapshots them, so a mid-call `setHooks()` cannot half-instrument a
 * run.
 *
 * @example
 * ```ts
 * const safety = createSafety({
 *   call: opts, resolved,
 *   promptId: prompt.id, model: opts.model,
 *   systemPrompt: resolved.system, traceId,
 * })
 *
 * ;({ messages } = await safety.guardInput({ messages }))
 *
 * const final = await safety.finalizeOutput(
 *   { text: validText, parsed },
 *   async (corrective) => {
 *     // The ONLY dialect-specific code: how to re-call the model.
 *     messages = [...appendRound(messages), ...corrective]
 *     const regen = await callModelAgain(messages)
 *     return revalidate(regen)
 *   },
 *   { suspended: finishReason === 'tool_approval_required' },
 * )
 *
 * const meta = safety.stamp({ usage, finishReason })
 * ```
 */
export function createSafety(options: SafetyCallOptions): Safety {
  return createSafetySession(options);
}

/** @internal Create a Safety session with primitive-owned exact-binding applicability. */
export function createSafetyWithBindingApplicability(
  options: SafetyCallOptions,
  applicability: SafetyBindingApplicability,
): Safety {
  return createSafetySession(options, applicability);
}

function createSafetySession(
  options: SafetyCallOptions,
  applicability?: SafetyBindingApplicability,
): Safety {
  // Snapshot runtime state once — a mid-call setHooks() cannot
  // half-instrument this run.
  const runtime = getHooks();

  const registry = buildSafetyRegistry({
    global: {
      constraints: runtime.globalConstraints,
      guardrails: runtime.globalGuardrails,
    },
    prompt: {
      constraints: options.resolved?.constraints,
      guardrails: options.resolved?.guardrails,
    },
    call: {
      constraints: options.call?.constraints,
      guardrails: options.call?.guardrails,
    },
    tune: options.safety,
    applicability,
  });

  const constraints = constraintsForMode(registry.bindings, "enforce");
  const reportConstraints = constraintsForMode(registry.bindings, "report");
  const guardrailBindings = enabledGuardrailBindings(registry.bindings);
  const disabledGuardEntries = disabledBindingEntries(registry.bindings);
  const dormantGuardEntries = dormantBindingEntries(registry.bindings);

  // Phase dispatch is keyed, not branched — the phase vocabulary can grow
  // (tool-args, tool-result, context-inject) without session surgery.
  const bindingsByPhase = new Map<"input" | "output", GuardrailBinding[]>();
  for (const binding of guardrailBindings) {
    const phase = boundaryPhase(binding.boundary);
    const list = bindingsByPhase.get(phase) ?? [];
    list.push(binding);
    bindingsByPhase.set(phase, list);
  }
  const phaseBindings = (
    phase: "input" | "output",
  ): readonly GuardrailBinding[] => bindingsByPhase.get(phase) ?? [];

  const enabled =
    constraints.length > 0 ||
    reportConstraints.length > 0 ||
    guardrailBindings.length > 0 ||
    disabledGuardEntries.length > 0 ||
    dormantGuardEntries.length > 0;
  const formatter = options.formatter ?? defaultConstraintFeedbackFormatter;
  const metadata = options.resolved?.metadata ?? {};
  const traceId = options.traceId;

  const transcript: SafetyProtocolEvent[] = [];
  let guardrailAudit: GuardrailAudit | undefined;
  let lastMessages: readonly Message[] = [];

  const guardContext = (
    _phase: "input" | "output",
    messages: readonly Message[],
    override?: OperationInputGuardContext,
    origin?: ModelInputOrigin,
  ): GuardrailContext => ({
    promptId: options.promptId,
    model: override ? override.model : options.model,
    messages,
    systemPrompt: override ? override.systemPrompt : options.systemPrompt,
    traceId,
    metadata,
    ...(origin ? { origin } : {}),
  });

  const constraintContext = (): ConstraintContext => ({
    promptId: options.promptId,
    model: options.model,
    traceId,
    attempt: 0,
    metadata,
  });

  const formatterContext = (): SafetyContext => ({
    promptId: options.promptId,
    model: options.model,
    traceId,
    metadata,
  });

  const constraintRunner = createSessionConstraintRunner({
    constraints,
    reportConstraints,
    formatter,
    formatterContext,
    constraintContext,
    constraintMaxRetries: options.call?.constraintMaxRetries,
    transcript,
  });

  const appendGuardrailAudit = (audit: GuardrailAudit): void => {
    guardrailAudit = {
      applied: [...(guardrailAudit?.applied ?? []), ...audit.applied],
      blocked: guardrailAudit?.blocked === true || audit.blocked,
    };
  };

  if (disabledGuardEntries.length > 0) {
    appendGuardrailAudit({ applied: disabledGuardEntries, blocked: false });
    recordBindingAuditEntries(disabledGuardEntries);
  }
  if (dormantGuardEntries.length > 0) {
    appendGuardrailAudit({ applied: dormantGuardEntries, blocked: false });
    recordBindingAuditEntries(dormantGuardEntries);
  }

  async function finalizeLanguageOutput(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts:
      | {
          readonly suspended?: boolean;
          readonly messages?: readonly Message[];
          readonly schema?: z.ZodType;
          readonly prepareValidated?: (
            guarded: SafetyOutput,
            guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
          ) => Promise<SafetyOutput>;
          readonly structuredContext?: StructuredSafetyContext;
          readonly objectOccurrencesAlreadyGated?: boolean;
          readonly settled?: readonly import("./constraint/settlement").ConstraintOccurrenceSettlement[];
        }
      | undefined,
    terminalOnly: boolean,
  ): Promise<SafetyOutput> {
    if (opts?.messages) lastMessages = opts.messages;
    return finalizeLanguageTerminal({
      output,
      regenerate,
      bindings: phaseBindings("output"),
      terminalOnly,
      enabled,
      suspended: opts?.suspended,
      messages: lastMessages,
      schema: opts?.schema,
      ...(opts?.prepareValidated
        ? { prepareValidated: opts.prepareValidated }
        : {}),
      ...(opts?.structuredContext
        ? { structuredContext: opts.structuredContext }
        : {}),
      objectOccurrencesAlreadyGated: opts?.objectOccurrencesAlreadyGated ?? false,
      ...(opts?.settled ? { settled: opts.settled } : {}),
      context: guardContext("output", lastMessages),
      appendAudit: appendGuardrailAudit,
      transcript,
      constraintsEnabled: constraints.length > 0,
      applyConstraints: constraintRunner.apply,
      applyReportConstraints: constraintRunner.report,
    });
  }

  // ── Streaming sub-protocol ─────────────────────────────────────

  function buildTextStream(): SafetyStream {
    return createSafetyStream({
      outputBindings: phaseBindings("output"),
      // Enforce-mode constraints can gate (an `assert` commits the attempt);
      // report-mode constraints are always report-only.
      constraints,
      reportConstraints,
      messages: () => lastMessages,
      guardContext: () => guardContext("output", lastMessages),
      constraintContext,
      appendGuardrailAudit,
      getConstraintAudit: () => constraintRunner.audit,
      setConstraintAudit: constraintRunner.replaceAudit,
      transcript,
    });
  }

  function openStream(): SafetyStream {
    // Standalone stream: a non-terminal assert rejection has no retry authority, so
    // it fails closed as the public `ConstraintViolationError`.
    return failClosedOnRejection(buildTextStream());
  }

  // Adapter (coordinated) text stream: the raw commit gate raises the non-terminal
  // rejection so the shared attempt coordinator can discard the attempt and retry,
  // exactly as the structured raw stream does (RFC #173).
  function openStreamRawForAdapter(): SafetyStream {
    return buildTextStream();
  }

  const session = createSafetySessionMethods({
    options,
    enabled,
    constraints,
    reportConstraints,
    phaseBindings,
    guardContext,
    constraintContext,
    appendGuardrailAudit,
    guardrailAudit: () => guardrailAudit,
    constraintRunner,
    transcript,
    messages: {
      get: () => lastMessages,
      set: (messages) => {
        lastMessages = messages;
      },
    },
    finalizeLanguageOutput,
    openStream,
    openStreamRaw: openStreamRawForAdapter,
  });
  return createScopedSafetySession(options.promptId, session);
}

function boundaryPhase(boundary: BoundaryDef): "input" | "output" {
  return isInputBoundary(boundary) ? "input" : "output";
}

function isInputBoundary(boundary: BoundaryDef): boolean {
  return (
    boundary.id === "model.input.text" ||
    boundary.id === "model.input.media" ||
    boundary.id === "model.instructions"
  );
}
