import type { Message } from "../generation/messages";
import type { ResultStepFacts } from "../adapter/result-accumulator";
import type { z } from "zod";
import { guardInput as guardSafetyInput } from "./input/runner";
import { guardInputOperationMedia } from "./input/operation-media";
import { guardInputOperationText } from "./input/operation-text";
import { guardOutputTextParts as guardCompletionTextParts } from "./output-text-parts";
import { guardOutputMedia as guardSafetyOutputMedia } from "./output/media";
import { guardOutputOperationText } from "./output/operation-text";
import { runOneShotConstraints } from "./output/one-shot";
import {
  assertStructuredStepRewrite,
  guardLanguageStepWithEdits,
} from "./output/step";
import { guardStreamCompletionContent } from "./output/completion";
import type { ConstraintContext } from "./constraint/types";
import type { GuardrailAudit, GuardrailContext } from "./guardrail/types";
import type { GuardrailBinding } from "./registry";
import type { ModelInputOrigin } from "./input-origin";
import { inputBindingsFor } from "./input/source";
import type { SessionConstraintRunner } from "./session-constraints";
import type {
  SafetyCallOptions,
  SafetyOutput,
  SafetyProtocolEvent,
  SafetyStream,
} from "./session-contract";
import {
  inputOperationMediaGuard,
  inputOperationTextGuard,
  languageStepGuard,
  languageStepGuardEnabled,
  languageStepTransform,
  languageTerminalFinalize,
  oneShotOutputConstraints,
  outputMediaGuard,
  outputOperationTextGuard,
  streamCompletionGuard,
  modelIngressGuard,
  modelIngressSources,
  resolvedInputGuard,
  type SafetySession,
} from "./session-bridge";
import { guardModelIngress } from "./input/model-ingress";
interface SessionMethodOptions {
  readonly options: SafetyCallOptions;
  readonly enabled: boolean;
  readonly constraints: readonly import("./constraint/types").Constraint[];
  readonly reportConstraints: readonly import("./constraint/types").Constraint[];
  readonly phaseBindings: (
    phase: "input" | "output",
  ) => readonly GuardrailBinding[];
  readonly guardContext: (
    phase: "input" | "output",
    messages: readonly Message[],
    override?: { readonly model?: string; readonly systemPrompt?: string },
    origin?: ModelInputOrigin,
  ) => GuardrailContext;
  readonly constraintContext: () => ConstraintContext;
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void;
  readonly guardrailAudit: () => GuardrailAudit | undefined;
  readonly constraintRunner: SessionConstraintRunner;
  readonly transcript: SafetyProtocolEvent[];
  readonly messages: {
    get(): readonly Message[];
    set(messages: readonly Message[]): void;
  };
  readonly finalizeLanguageOutput: (
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts:
      | {
          readonly suspended?: boolean;
          readonly messages?: readonly Message[];
          readonly schema?: z.ZodType;
        }
      | undefined,
    terminalOnly: boolean,
  ) => Promise<SafetyOutput>;
  readonly openStream: () => SafetyStream;
}
/** Build the method table after session state and runners are initialized. */
export function createSafetySessionMethods(
  state: SessionMethodOptions,
): SafetySession {
  const outputBindings = () => state.phaseBindings("output");
  const guardIngress = (input: Parameters<SafetySession[typeof modelIngressGuard]>[0]) =>
    guardModelIngress({
      bindings: state.phaseBindings("input"),
      input,
      context: state.guardContext("input", state.messages.get()),
      appendAudit: state.appendGuardrailAudit,
    });
  const ingressSources = (['user', 'tool', 'retrieval'] as const).filter((source) => {
    const inputBindings = state.phaseBindings("input");
    const matchesText = inputBindingsFor(inputBindings, "model.input.text", source).length > 0;
    const matchesMedia =
      source !== "retrieval" && inputBindingsFor(inputBindings, "model.input.media", source).length > 0;
    return matchesText || matchesMedia;
  });
  const guardInput = async (
    input: Parameters<SafetySession["guardInput"]>[0],
    systemIngress?: Parameters<SafetySession[typeof resolvedInputGuard]>[1],
    systemIngressScope?: Parameters<SafetySession[typeof resolvedInputGuard]>[2],
  ) => {
    state.messages.set(input.messages);
    const result = await guardSafetyInput({
      bindings: state.phaseBindings("input"),
      input,
      ...(systemIngress ? { systemIngress } : {}),
      ...(systemIngressScope ? { systemIngressScope } : {}),
      context: (messages, origin) => state.guardContext("input", messages, undefined, origin),
      appendAudit: state.appendGuardrailAudit,
      transcript: state.transcript,
    });
    state.messages.set(result.messages);
    return result;
  };
  return {
    enabled: state.enabled,
    [modelIngressGuard]: guardIngress,
    [modelIngressSources]: Object.freeze(ingressSources),
    [resolvedInputGuard]: guardInput,
    [languageStepGuardEnabled]: outputBindings().some(
      (binding) =>
        binding.boundary.id === "model.output.text" ||
        binding.boundary.id === "model.output.media",
    ),

    async [languageStepGuard](stepIndex, facts, schema) {
      const result = await guardLanguageStepWithEdits({
        stepIndex,
        facts,
        bindings: outputBindings(),
        context: state.guardContext("output", state.messages.get()),
        appendAudit: state.appendGuardrailAudit,
        transcript: state.transcript,
      });
      assertStructuredStepRewrite({
        original: facts,
        guarded: result.facts,
        schema,
        policyId: result.rewritePolicyId,
      });
      return result.facts;
    },

    async [languageStepTransform](step, schema) {
      const original: ResultStepFacts = {
        content: step.content,
        finishReason: undefined,
        responseId: undefined,
        modelId: undefined,
      };
      const result = await guardLanguageStepWithEdits({
        stepIndex: step.index,
        facts: original,
        bindings: outputBindings(),
        context: state.guardContext("output", state.messages.get()),
        appendAudit: state.appendGuardrailAudit,
        transcript: state.transcript,
      });
      assertStructuredStepRewrite({
        original,
        guarded: result.facts,
        schema,
        policyId: result.rewritePolicyId,
      });
      return result.edits;
    },

    [languageTerminalFinalize]: (output, regenerate, opts) =>
      state.finalizeLanguageOutput(output, regenerate, opts, true),

    [streamCompletionGuard]: (
      content,
      liveText,
      representedText,
      liveTextSlots,
    ) =>
      guardStreamCompletionContent({
        content,
        liveText,
        representedText,
        liveTextSlots,
        bindings: outputBindings(),
        context: state.guardContext("output", state.messages.get()),
        appendAudit: state.appendGuardrailAudit,
        transcript: state.transcript,
      }),

    guardInput,

    finalizeOutput: (output, regenerate, opts) =>
      state.finalizeLanguageOutput(output, regenerate, opts, false),

    guardOutputTextParts: (parts) =>
      guardCompletionTextParts({
        bindings: outputBindings(),
        parts,
        context: state.guardContext("output", state.messages.get()),
        appendAudit: state.appendGuardrailAudit,
        transcript: state.transcript,
      }),

    [inputOperationTextGuard]: (slots, context) =>
      guardInputOperationText({
        bindings: state.phaseBindings("input"),
        slots,
        context: state.guardContext("input", state.messages.get(), context),
        appendAudit: state.appendGuardrailAudit,
      }),

    [inputOperationMediaGuard]: (items, groups, dependencies) =>
      guardInputOperationMedia({
        bindings: inputBindingsFor(
          state.phaseBindings("input"),
          "model.input.media",
          "user",
        ),
        items,
        groups,
        dependencies,
        context: state.guardContext("input", state.messages.get()),
        appendAudit: state.appendGuardrailAudit,
      }),

    [outputMediaGuard]: (subjects, mediaOptions) =>
      guardSafetyOutputMedia({
        bindings: outputBindings().filter(
          (binding) => binding.boundary.id === "model.output.media",
        ),
        subjects,
        minimumRetained: mediaOptions?.minimumRetained ?? 0,
        context: {
          ...state.guardContext("output", state.messages.get()),
          model: mediaOptions?.model ?? state.options.model,
        },
        appendAudit: state.appendGuardrailAudit,
      }),

    [outputOperationTextGuard]: (text, model) =>
      guardOutputOperationText({
        bindings: outputBindings(),
        text,
        context: {
          ...state.guardContext("output", state.messages.get()),
          model: model ?? state.options.model,
        },
        appendAudit: state.appendGuardrailAudit,
      }),

    async [oneShotOutputConstraints](text, model) {
      const audit = await runOneShotConstraints({
        constraints: state.constraints.filter(
          (constraint) => constraint.on.id === "model.output.text",
        ),
        reportConstraints: state.reportConstraints.filter(
          (constraint) => constraint.on.id === "model.output.text",
        ),
        text,
        context: {
          ...state.constraintContext(),
          model: model ?? state.options.model,
        },
      });
      if (audit) state.constraintRunner.replaceAudit(audit);
    },

    get audit() {
      const guardrails = state.guardrailAudit();
      return {
        ...(guardrails ? { guardrails } : {}),
        ...(state.constraintRunner.audit
          ? { constraints: state.constraintRunner.audit }
          : {}),
      };
    },

    stamp(meta) {
      if (!state.enabled) return meta;
      state.transcript.push({ t: "stamp" });
      const guardrails = state.guardrailAudit();
      return {
        ...meta,
        ...(guardrails && (guardrails.applied.length > 0 || guardrails.blocked)
          ? { guardrails }
          : {}),
        ...(state.constraintRunner.audit &&
        state.constraintRunner.audit.entries.length > 0
          ? { constraints: state.constraintRunner.audit }
          : {}),
      };
    },

    openStream: state.openStream,
    transcript: state.transcript,
  };
}
