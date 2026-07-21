/** Canonical tool ingress on resumed Core stream requests. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { Message } from "../../src/generation/messages";
import { boundary, guardrail } from "../../src/safety";
import { appendToolApprovalResponse } from "../../src/tools/approvals";
import { toolIngressPrompt as textPrompt, toolIngressScript as coreStepScript } from "./tool-ingress.fixture";

describe("Core stream tool ingress", () => {
  it("guards an approved tool result before a resumed Core stream request", async () => {
    const scripted = coreStepScript([
      {
        text: "approval needed",
        toolCalls: [{ id: "call-stream", name: "lookup", args: {} }],
      },
    ]);
    const runtime = adapter(scripted.spec)(scripted.client);
    const tools = {
      lookup: {
        description: "lookup",
        execute: async () => "private stream result",
      },
    };
    const suspended = await runtime.generate(textPrompt(), {
      model: "test-model",
      input: { message: "go" },
      tools,
      toolApproval: { lookup: "always" },
    });
    const request = (
      suspended.messages.at(-1)?.metadata as {
        readonly toolApprovalRequests: readonly {
          readonly approvalId: string;
          readonly approvalToken: string;
        }[];
      }
    ).toolApprovalRequests[0]!;
    const messages = appendToolApprovalResponse(suspended.messages, {
      approvalId: request.approvalId,
      approvalToken: request.approvalToken,
      approved: true,
    }) as Message[];

    const stream = await runtime.stream(textPrompt(), {
      model: "test-model",
      input: { message: "go" },
      messages,
      tools,
      toolApproval: { lookup: "always" },
      guardrails: [
        guardrail({
          id: "rewrite-stream-tool-result",
          on: boundary.input.text({ from: "tool" }),
          run: () => ({
            action: "rewrite",
            value: "safe stream result",
            rewrite: { kind: "redact" },
          }),
        }),
      ],
    });

    expect(scripted.providerMessages[1]).toContainEqual(
      expect.objectContaining({ role: "tool", content: "safe stream result" }),
    );
    for await (const _text of stream.textStream) {
      // Drain the stream so its completion owner can settle.
    }
    await stream.completion;
  });

});
