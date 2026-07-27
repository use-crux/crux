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
import type {
  GuardrailAudit,
  GuardrailContext,
  GuardrailOrigin,
} from "./guardrail/types";
import type { GuardrailBinding } from "./registry";
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
  outputDownstreamMutators,
  outputTerminalTextGuards,
  languageStepTransform,
  languageTerminalFinalize,
  oneShotOutputConstraints,
  outputMediaGuard,
  outputOperationTextGuard,
  streamCompletionGuard,
  modelIngressGuard,
  modelIngressSources,
  resolvedInputGuard,
  structuredStreamOpen,
  structuredStreamOpenRaw,
  streamOpenRaw,
  streamCommitPlan,
  toolDefinitionGuard,
  toolDescriptionGuard,
  memoryWriteGuard,
  type SafetySession,
  type StructuredSafetyContext,
} from "./session-bridge";
import { createStructuredSafetyStream } from "./stream/structured-engine";
import { failClosedOnRejection } from "./stream/fail-closed";
import { guardModelIngress } from "./input/model-ingress";
import type {
  FeedbackIngressGuard,
  SafetyRegenerate,
} from "./session-feedback-guard";
import { feedbackIngressGuard } from "./session-bridge";
import type { ToolExposureGuards } from "../adapter/tool/exposure/types";
import type { ManagedMemoryWriteGuard } from "../memory/managed-write-guard";
interface SessionMethodOptions {
  readonly options: SafetyCallOptions;
  readonly enabled: boolean;
  readonly constraints: readonly import("./constraint/types").Constraint[];
  readonly reportConstraints: readonly import("./constraint/types").Constraint[];
  readonly phaseBindings: (
    phase: "input" | "output",
  ) => readonly GuardrailBinding[];
  readonly guardContext: <
    TOrigin extends GuardrailOrigin = import("./input-origin").ModelInputOrigin,
  >(
    phase: "input" | "output",
    messages: readonly Message[],
    override?: { readonly model?: string; readonly systemPrompt?: string },
    origin?: TOrigin,
  ) => GuardrailContext<TOrigin>;
  readonly constraintContext: () => ConstraintContext;
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void;
  readonly guardrailAudit: () => GuardrailAudit | undefined;
  /** Whether a post-result managed-memory guard may append audit entries. */
  readonly lateGuardrailAudit: boolean;
  readonly constraintRunner: SessionConstraintRunner;
  readonly transcript: SafetyProtocolEvent[];
  readonly messages: {
    get(): readonly Message[];
    set(messages: readonly Message[]): void;
  };
  readonly finalizeLanguageOutput: (
    output: SafetyOutput,
    regenerate: SafetyRegenerate,
    opts:
      | {
          readonly suspended?: boolean;
          readonly messages?: readonly Message[];
          readonly schema?: z.ZodType;
          readonly retryAuthority?: "none";
          readonly stepOutputAlreadyGated?: boolean;
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
  ) => Promise<SafetyOutput>;
  readonly openStream: () => SafetyStream;
  readonly openStreamRaw: () => SafetyStream;
  readonly guardFeedback: FeedbackIngressGuard;
  readonly toolExposureGuards: ToolExposureGuards;
  readonly managedMemoryWriteGuard: ManagedMemoryWriteGuard;
}
/** Build the method table after session state and runners are initialized. */
export function createSafetySessionMethods(
  state: SessionMethodOptions,
): SafetySession {
  const outputBindings = () => state.phaseBindings("output");
  // A composite `model.output` guard or an output-media guard can change or strip
  // content after it was produced, so anything they govern must not be published
  // before they have run. One definition, shared by every deferral decision.
  const hasDownstreamMutator = (): boolean =>
    outputBindings().some(
      (binding) =>
        binding.boundary.id === "model.output" ||
        binding.boundary.id === "model.output.media",
    );
  const guardIngress = (
    input: Parameters<SafetySession[typeof modelIngressGuard]>[0],
  ) =>
    guardModelIngress({
      bindings: state.phaseBindings("input"),
      input,
      context: state.guardContext("input", state.messages.get()),
      appendAudit: state.appendGuardrailAudit,
    });
  const ingressSources = (["user", "tool", "retrieval"] as const).filter(
    (source) => {
      const inputBindings = state.phaseBindings("input");
      const matchesText =
        inputBindingsFor(inputBindings, "model.input.text", source).length > 0;
      const matchesMedia =
        source !== "retrieval" &&
        inputBindingsFor(inputBindings, "model.input.media", source).length > 0;
      return matchesText || matchesMedia;
    },
  );
  const buildStructuredStream = (structuredContext?: StructuredSafetyContext) =>
    createStructuredSafetyStream({
      objectBindings: outputBindings().filter(
        (binding) => binding.boundary.id === "model.output.object",
      ),
      textBindings: outputBindings().filter(
        (binding) => binding.boundary.id === "model.output.text",
      ),
      // `assert`-severity constraints commit the attempt on the live stream: they
      // hold release until resolved and fail closed on failure.
      assertConstraints: state.constraints.filter(
        (constraint) => constraint.severity === "assert",
      ),
      constraintContext: state.constraintContext(),
      guardContext: {
        ...state.guardContext("output", state.messages.get()),
        stream: { segment: true, last: true, heldChars: 0, heldMs: 0 },
      },
      appendGuardrailAudit: state.appendGuardrailAudit,
      // These also change the represented JSON after the object gate cleared it, so
      // they defer commitment exactly as a text guard does.
      downstreamMutators: hasDownstreamMutator(),
      ...(structuredContext?.canonicalSchema
        ? { canonicalSchema: structuredContext.canonicalSchema }
        : {}),
      ...(structuredContext?.decodeManifest
        ? { manifest: structuredContext.decodeManifest }
        : {}),
      transcript: state.transcript,
    });
  const guardInput = async (
    input: Parameters<SafetySession["guardInput"]>[0],
    systemIngress?: Parameters<SafetySession[typeof resolvedInputGuard]>[1],
    systemIngressScope?: Parameters<
      SafetySession[typeof resolvedInputGuard]
    >[2],
  ) => {
    state.messages.set(input.messages);
    const result = await guardSafetyInput({
      bindings: state.phaseBindings("input"),
      input,
      ...(systemIngress ? { systemIngress } : {}),
      ...(systemIngressScope ? { systemIngressScope } : {}),
      context: (messages, origin) =>
        state.guardContext("input", messages, undefined, origin),
      appendAudit: state.appendGuardrailAudit,
      transcript: state.transcript,
    });
    state.messages.set(result.messages);
    return result;
  };
  return {
    enabled: state.enabled,
    // An enforce `assert` is the only Safety-owned commit gate today: it holds
    // every streamed byte until resolved and fails the attempt closed on failure.
    [streamCommitPlan]: {
      hasAssertGate: state.constraints.some(
        (constraint) => constraint.severity === "assert",
      ),
    },
    [modelIngressGuard]: guardIngress,
    [feedbackIngressGuard]: state.guardFeedback,
    [toolDefinitionGuard]: state.toolExposureGuards.root,
    [toolDescriptionGuard]: state.toolExposureGuards.descriptions,
    [memoryWriteGuard]: state.managedMemoryWriteGuard,
    [modelIngressSources]: Object.freeze(ingressSources),
    [resolvedInputGuard]: guardInput,
    [outputDownstreamMutators]: hasDownstreamMutator(),
    // `model.output.text` runs over reasoning parts at completion, so it can
    // rewrite or block content the live text transform never gated.
    [outputTerminalTextGuards]: outputBindings().some(
      (binding) => binding.boundary.id === "model.output.text",
    ),
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
      state.finalizeLanguageOutput(
        output,
        regenerate,
        opts,
        opts?.stepOutputAlreadyGated ?? true,
      ),

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

    // Standalone structured stream: no regeneration authority, so a non-terminal
    // assert rejection fails closed as the public error.
    [structuredStreamOpen]: (structuredContext) =>
      failClosedOnRejection(buildStructuredStream(structuredContext)),

    // Adapter (coordinated) structured stream: the raw commit gate raises the
    // non-terminal rejection so the shared attempt coordinator can retry.
    [structuredStreamOpenRaw]: (structuredContext) =>
      buildStructuredStream(structuredContext),

    // Adapter (coordinated) text stream: same non-terminal rejection contract as the
    // structured raw stream, so a text `assert` retries on both routes.
    [streamOpenRaw]: () => state.openStreamRaw(),

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
      const stamped = {
        ...meta,
        ...(!state.lateGuardrailAudit &&
        guardrails &&
        (guardrails.applied.length > 0 || guardrails.blocked)
          ? { guardrails }
          : {}),
        ...(state.constraintRunner.audit &&
        state.constraintRunner.audit.entries.length > 0
          ? { constraints: state.constraintRunner.audit }
          : {}),
      };
      if (state.lateGuardrailAudit) {
        Object.defineProperty(stamped, "guardrails", {
          enumerable: true,
          get: () => {
            const audit = state.guardrailAudit();
            return audit && (audit.applied.length > 0 || audit.blocked)
              ? audit
              : undefined;
          },
        });
      }
      return stamped;
    },

    openStream: state.openStream,
    transcript: state.transcript,
  };
}
