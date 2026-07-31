/** Constraint regeneration is a new guarded provider step in both dialects. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { AdapterSpec } from "../../src/adapter/spec";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { AdapterResponse } from "../../src/adapter/types";
import type { CallArgs } from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { boundary, constraint, guardrail } from "../../src/safety";
import { permissiveCapabilities } from "./structured-output/capability-fixtures";

const textPrompt = prompt({
  id: "language-step-regeneration",
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
});

const structuredPrompt = prompt({
  id: "language-step-invalid-structured-regeneration",
  prompt: "return JSON",
  output: z.object({ value: z.string() }),
});

const needsShip = () =>
  constraint({
    id: "regenerated-ship",
    on: boundary.output.text(),
    maxRetries: 1,
    run: (text) =>
      text.includes("ship")
        ? { pass: true as const }
        : { pass: false as const, feedback: "mention ship" },
  });

describe("language step Safety — constraint regeneration", () => {
  it("guards a core regeneration once before constraints and envelope assembly", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    const textSeen: string[] = [];
    const mediaOrigins: unknown[] = [];
    const feedbackOrigins: unknown[] = [];
    let legacyFeedbackCalls = 0;
    const scripted = coreScript([
      { text: "draft" },
      {
        text: "unsafe ship",
        content: [image, { type: "text", text: "unsafe ship" }],
      },
    ]);

    const result = await adapter(scripted.spec)(scripted.client).generate(
      textPrompt,
      {
        model: "test-model",
        input: { message: "write" },
        constraints: [needsShip()],
        guardrails: [
          rewriteUnsafe(textSeen),
          guardrail({
            id: "strip-regenerated-media",
            on: boundary.output.media(),
            run: (subject) => {
              mediaOrigins.push(subject.origin);
              return { action: "strip", reason: "remove media" };
            },
          }),
          rewriteFeedback(feedbackOrigins),
          guardrail({
            id: "legacy-must-ignore-constraint",
            on: boundary.validation.feedback(),
            run: () => {
              legacyFeedbackCalls += 1;
              return { action: "allow" };
            },
          }),
        ],
      },
    );

    expect(textSeen).toEqual(["draft", "unsafe ship"]);
    expect(mediaOrigins).toEqual([
      { kind: "step", stepIndex: 1, partIndex: 0 },
    ]);
    expect(result.steps.map((step) => step.text)).toEqual(["", "safe ship"]);
    expect(result.steps[0]?.request).toBeDefined();
    expect(result.steps[1]?.request?.previousRequestId).toBe(
      result.steps[0]?.request?.id,
    );
    expect(result.finalStep.text).toBe("safe ship");
    expect(result.text).toBe("safe ship");
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "safe ship" }],
    });
    expect(JSON.stringify(scripted.requests[1]?.messages)).toContain(
      "guarded rejected draft",
    );
    expect(JSON.stringify(scripted.requests[1]?.messages)).toContain(
      "mention safe ship",
    );
    expect(feedbackOrigins).toEqual([
      { source: "feedback", kind: "rejected-output", attempt: 1 },
      { source: "feedback", kind: "constraint-feedback", attempt: 1 },
    ]);
    expect(legacyFeedbackCalls).toBe(0);
  });

  it("guards an SDK-loop regeneration once with a monotonic provider ordinal", async () => {
    const seen: string[] = [];
    const feedbackOrigins: unknown[] = [];
    const fake = fakeLoopRuntime({
      loops: [[{ text: "draft" }], [{ text: "unsafe ship" }]],
    });

    const result = await loopRuntimeAdapter(fake.runtime).generate(textPrompt, {
      model: "fake:test-model",
      input: { message: "write" },
      constraints: [needsShip()],
      guardrails: [rewriteUnsafe(seen), rewriteFeedback(feedbackOrigins)],
    });

    expect(seen).toEqual(["draft", "unsafe ship"]);
    expect(result.steps.map((step) => step.text)).toEqual(["", "safe ship"]);
    expect(result.steps[0]?.request).toBeDefined();
    expect(result.steps[1]?.request?.previousRequestId).toBe(
      result.steps[0]?.request?.id,
    );
    expect(result.finalStep.text).toBe("safe ship");
    expect(result.text).toBe("safe ship");
    expect(JSON.stringify(fake.calls.runTextLoop[1]?.messages)).toContain(
      "guarded rejected draft",
    );
    expect(JSON.stringify(fake.calls.runTextLoop[1]?.messages)).toContain(
      "mention safe ship",
    );
    expect(feedbackOrigins).toEqual([
      { source: "feedback", kind: "rejected-output", attempt: 1 },
      { source: "feedback", kind: "constraint-feedback", attempt: 1 },
    ]);
  });

  it("rejects a schema-invalid core regeneration before constraint recheck", async () => {
    const constraintSeen: string[] = [];
    const stepSeen: string[] = [];
    const scripted = coreScript([
      response('{"value":"draft"}'),
      response("ship but not JSON"),
    ]);

    await expect(
      adapter(scripted.spec)(scripted.client).generate(structuredPrompt, {
        model: "test-model",
        validationRetry: { maxRetries: 0 },
        constraints: [structuredNeedsShip(constraintSeen)],
        guardrails: [observeSteps(stepSeen)],
      }),
    ).rejects.toMatchObject({ name: "ValidationExhaustedError" });

    expect(stepSeen).toEqual(['{"value":"draft"}', "ship but not JSON"]);
    expect(constraintSeen).toEqual(['{"value":"draft"}']);
    expect(scripted.calls).toBe(2);
  });

  it("rejects a schema-invalid SDK regeneration before constraint recheck", async () => {
    const constraintSeen: string[] = [];
    const stepSeen: string[] = [];
    const fake = fakeLoopRuntime({
      structured: ['{"value":"draft"}', "ship but not JSON"],
    });

    await expect(
      loopRuntimeAdapter(fake.runtime).generate(structuredPrompt, {
        model: "fake:test-model",
        validationRetry: { maxRetries: 0 },
        constraints: [structuredNeedsShip(constraintSeen)],
        guardrails: [observeSteps(stepSeen)],
      }),
    ).rejects.toMatchObject({ name: "ValidationExhaustedError" });

    expect(stepSeen).toEqual(['{"value":"draft"}', "ship but not JSON"]);
    expect(constraintSeen).toEqual(['{"value":"draft"}']);
    expect(fake.calls.runStructuredAttempt).toHaveLength(2);
  });
});

function structuredNeedsShip(seen: string[]) {
  return constraint({
    id: "structured-regenerated-ship",
    on: boundary.output.text(),
    maxRetries: 1,
    run: (text) => {
      seen.push(text);
      return text.includes("ship")
        ? { pass: true as const }
        : { pass: false as const, feedback: "mention ship" };
    },
  });
}

function observeSteps(seen: string[]) {
  return guardrail({
    id: "observe-structured-regeneration-steps",
    on: boundary.output.text(),
    run: (text) => {
      seen.push(text);
      return { action: "allow" as const };
    },
  });
}

function rewriteUnsafe(seen: string[]) {
  return guardrail({
    id: "rewrite-regenerated-text",
    on: boundary.output.text(),
    run: (text) => {
      seen.push(text);
      return text.startsWith("unsafe")
        ? {
            action: "rewrite" as const,
            value: text.replace("unsafe", "safe"),
            rewrite: { kind: "normalize" as const },
          }
        : { action: "allow" as const };
    },
  });
}

function rewriteFeedback(origins: unknown[]) {
  return guardrail({
    id: `rewrite-feedback-${origins.length}`,
    on: boundary.input.text({ from: "feedback" }),
    run: (text, context) => {
      origins.push(context.origin);
      return {
        action: "rewrite" as const,
        value: text
          .replace("draft", "guarded rejected draft")
          .replace("mention ship", "mention safe ship"),
        rewrite: { kind: "redact" as const },
      };
    },
  });
}

function coreScript(responses: readonly AdapterResponse[]) {
  const queue = [...responses];
  const requests: CallArgs[] = [];
  const client = { kind: "constraint-regeneration" as const };
  const spec: AdapterSpec<typeof client, { readonly call: number }, never> = {
    providerId: "constraint-regeneration",
    structuredOutput: { accepts: permissiveCapabilities },
    async call(_client, args) {
      requests.push(args);
      return {
        raw: { call: responses.length - queue.length },
        extracted: queue.shift()!,
      };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, assistant) {
      return [...messages, { role: "assistant", content: assistant.text }];
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
  return {
    spec,
    client,
    requests,
    get calls() {
      return responses.length - queue.length;
    },
  };
}

function response(text: string): AdapterResponse {
  return {
    text,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
