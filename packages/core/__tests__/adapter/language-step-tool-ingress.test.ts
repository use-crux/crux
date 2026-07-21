/** Canonical text and JSON tool ingress through the public Core adapter. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";
import { toolPolicy } from "../../src/safety/toolPolicy";
import { toolIngressPrompt as textPrompt, toolIngressScript as coreStepScript } from "./tool-ingress.fixture";

describe("Core text tool ingress", () => {
  it("guards canonical output only after raw result policy and conversion", async () => {
    const events: string[] = [];
    const raw = { secret: "domain value" };
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-order", name: "lookup", args: {} }],
      },
      { text: "done" },
    ]);

    await adapter(scripted.spec)(scripted.client).generate(textPrompt(), {
      model: "test-model",
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          execute: async () => raw,
          toModelOutput: ({ output }) => {
            expect(output).toBe(raw);
            events.push("convert");
            return { type: "text", value: "canonical summary" };
          },
        },
      },
      toolMiddleware: toolPolicy.result({
        id: "inspect-raw-result",
        match: "lookup",
        run: (subject) => {
          expect(subject.output).toBe(raw);
          events.push("raw-policy");
          return { action: "allow" };
        },
      }),
      guardrails: [
        guardrail({
          id: "inspect-canonical-tool-text",
          on: boundary.input.text({ from: "tool" }),
          run: (text) => {
            expect(text).toBe("canonical summary");
            events.push("model-ingress");
            return { action: "allow" };
          },
        }),
      ],
    });

    expect(events).toEqual(["raw-policy", "convert", "model-ingress"]);
  });

  it("blocks canonical JSON text before a subsequent provider request", async () => {
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-json", name: "lookup", args: {} }],
      },
      { text: "must not continue" },
    ]);

    await expect(
      adapter(scripted.spec)(scripted.client).generate(textPrompt(), {
        model: "test-model",
        input: { message: "go" },
        tools: {
          lookup: {
            description: "lookup",
            execute: async () => ({ secret: true }),
          },
        },
        guardrails: [
          guardrail({
            id: "block-canonical-json",
            on: boundary.input.text({ from: "tool" }),
            run: (text) => {
              expect(text).toBe('{"secret":true}');
              return { action: "block", reason: "unsafe canonical JSON" };
            },
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    expect(scripted.calls).toBe(1);
  });

  it("routes default and filtered text policies once per semantic source", async () => {
    const defaultSources: string[] = [];
    const userSources: string[] = [];
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-routing", name: "lookup", args: {} }],
      },
      { text: "done" },
    ]);

    await adapter(scripted.spec)(scripted.client).generate(textPrompt(), {
      model: "test-model",
      input: { message: "go" },
      tools: {
        lookup: { description: "lookup", execute: async () => "result" },
      },
      guardrails: [
        guardrail({
          id: "all-text-inputs",
          on: boundary.input.text(),
          run: (_text, context) => {
            defaultSources.push(context.origin.source);
            return { action: "allow" };
          },
        }),
        guardrail({
          id: "user-text-only",
          on: boundary.input.text({ from: "user" }),
          run: (_text, context) => {
            userSources.push(context.origin.source);
            return { action: "allow" };
          },
        }),
      ],
    });

    expect(defaultSources).toEqual(["user", "tool"]);
    expect(userSources).toEqual(["user"]);
  });

  it("reports tool media and text actions without mutating canonical output", async () => {
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-report", name: "lookup", args: {} }],
      },
      { text: "done" },
    ]);

    const result = await adapter(scripted.spec)(scripted.client).generate(
      textPrompt(),
      {
        model: "test-model",
        input: { message: "go" },
        tools: {
          lookup: {
            description: "lookup",
            execute: async () => "raw",
            toModelOutput: () => ({
              type: "content" as const,
              value: [
                { type: "text" as const, text: "private summary" },
                {
                  type: "image" as const,
                  source: new Uint8Array([1, 2, 3]),
                  mediaType: "image/png",
                },
              ],
            }),
          },
        },
        guardrails: [
          guardrail({
            id: "report-tool-image",
            mode: "report",
            on: boundary.input.media({ from: "tool" }),
            run: () => ({ action: "strip", reason: "would strip" }),
          }),
          guardrail({
            id: "report-tool-text",
            mode: "report",
            on: boundary.input.text({ from: "tool" }),
            run: () => ({
              action: "rewrite",
              value: "would rewrite",
              rewrite: { kind: "redact" },
            }),
          }),
        ],
      },
    );

    expect(scripted.providerMessages[1]).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content:
          "private summary\n[image image/png 3B sha256:039058c6f2c0]",
      }),
    );
    expect(result._meta.guardrails?.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: "report-tool-image",
          mode: "report",
          action: "strip",
        }),
        expect.objectContaining({
          guard: "report-tool-text",
          mode: "report",
          action: "redact",
        }),
      ]),
    );
  });

});
