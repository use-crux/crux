/** Privacy and fail-closed coverage for folded retrieval provenance. */

import { describe, expect, it } from "vitest";
import type { Message } from "../../src/generation/messages";
import { context } from "../../src/prompt/context";
import { prompt } from "../../src/prompt/prompt";
import { retriever } from "../../src/retrieval";
import { systemIngressCarrierFor } from "../../src/resolver/system-ingress-provenance";
import {
  boundary,
  createSafety,
  guardrail,
  SafetyResultError,
} from "../../src/safety";
import { guardSafetySessionResolvedInput } from "../../src/safety/session";

describe("folded retrieval provenance", () => {
  it("stays outside public fields, spreads, serialization, and message metadata", async () => {
    const resolved = await messagesPrompt().resolve({});
    const carrier = systemIngressCarrierFor(resolved);

    expect(carrier).toMatchObject({
      mode: "messages",
      targetMessageIndex: 0,
      hasTrustedSuffix: true,
      blocks: [
        expect.objectContaining({
          family: "retriever",
          contextId: "retriever:private-docs",
        }),
      ],
    });
    expect(Object.keys(resolved)).not.toContain("systemIngress");
    expect(systemIngressCarrierFor({ ...resolved })).toBeUndefined();
    expect(JSON.parse(JSON.stringify(resolved))).toEqual({ ...resolved });
    expect(
      resolved.messages?.every((message) => !("metadata" in message)),
    ).toBe(true);
  });

  it("uses resolver-owned family instead of a spoofable context id prefix", async () => {
    const instructionsSeen: string[] = [];
    let retrievalRuns = 0;
    const spoofed = context({
      id: "retriever:spoofed-application-context",
      system: "Application-authored trusted text.",
    });
    const resolved = await prompt({
      id: "spoofed-retrieval-family",
      use: [spoofed],
      messages: () => [{ role: "user" as const, content: "Question." }],
    }).resolve({});
    const safety = createSafety({
      promptId: "spoofed-retrieval-family",
      model: "test-model",
      call: {
        guardrails: [
          guardrail({
            id: "trusted-instructions",
            on: boundary.input.instructions(),
            run: (text) => {
              instructionsSeen.push(text);
              return { action: "allow" };
            },
          }),
          guardrail({
            id: "real-retrieval-only",
            on: boundary.input.text({ from: "retrieval" }),
            run: () => {
              retrievalRuns++;
              return { action: "allow" };
            },
          }),
        ],
      },
    });

    await guardSafetySessionResolvedInput(
      safety,
      resolved,
      {
        messages: resolved.messages as Message[],
      },
      {
        resolvedMessages: "selected",
      },
    );

    expect(instructionsSeen).toEqual(["Application-authored trusted text."]);
    expect(retrievalRuns).toBe(0);
  });

  it("fails closed when an applicable policy sees a changed folded prefix", async () => {
    const resolved = await messagesPrompt().resolve({});
    const changed = replaceFirstSystem(resolved.messages as Message[]);
    let retrievalRuns = 0;
    const safety = createSafety({
      promptId: "folded-prefix-mismatch",
      model: "test-model",
      call: {
        guardrails: [
          guardrail({
            id: "unrelated-user-prefix-policy",
            on: boundary.input.text({ from: "user" }),
            run: () => ({ action: "allow" }),
          }),
          guardrail({
            id: "retrieval-prefix-policy",
            on: boundary.input.text({ from: "retrieval" }),
            run: () => {
              retrievalRuns++;
              return { action: "allow" };
            },
          }),
        ],
      },
    });

    await expect(
      guardSafetySessionResolvedInput(
        safety,
        resolved,
        { messages: changed },
        { resolvedMessages: "selected" },
      ),
    ).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: "retrieval-prefix-policy",
      boundary: "model.input.text",
    });
    expect(retrievalRuns).toBe(0);
  });

  it("preserves message identity when no policy applies to the folded carrier", async () => {
    const resolved = await messagesPrompt().resolve({});
    const changed = replaceFirstSystem(resolved.messages as Message[]);
    let userRuns = 0;
    const safety = createSafety({
      promptId: "folded-prefix-no-policy",
      model: "test-model",
      call: {
        guardrails: [
          guardrail({
            id: "unrelated-user-policy",
            on: boundary.input.text({ from: "user" }),
            run: () => {
              userRuns++;
              return { action: "allow" };
            },
          }),
        ],
      },
    });

    const result = await guardSafetySessionResolvedInput(
      safety,
      resolved,
      {
        messages: changed,
      },
      {
        resolvedMessages: "selected",
      },
    );

    expect(result.messages).toBe(changed);
    expect(result.messages[0]).toBe(changed[0]);
    expect(result.messages[0]?.content).toBe("Changed after resolution.");
    expect(userRuns).toBe(1);
  });

  it("exposes only safe origin coordinates and keeps retrieval values out of audit", async () => {
    const resolved = await messagesPrompt().resolve({});
    const seenOrigins: unknown[] = [];
    const safety = createSafety({
      promptId: "retrieval-audit-privacy",
      model: "test-model",
      call: {
        guardrails: [
          guardrail({
            id: "retrieval-audit-policy",
            on: boundary.input.text({ from: "retrieval" }),
            run: (_text, ctx) => {
              seenOrigins.push(ctx.origin);
              return { action: "allow" };
            },
          }),
        ],
      },
    });

    await guardSafetySessionResolvedInput(
      safety,
      resolved,
      {
        messages: resolved.messages as Message[],
      },
      {
        resolvedMessages: "selected",
      },
    );

    expect(seenOrigins).toEqual([
      {
        source: "retrieval",
        kind: "retrieval-context",
        retrieverId: "private-docs",
        blockIndex: 0,
      },
    ]);
    const audit = JSON.stringify(safety.audit);
    expect(audit).not.toContain("private retrieval value");
    expect(audit).not.toContain("sensitive query");
    expect(audit).not.toContain("private.example");
    expect(audit).not.toContain("/private/source.md");
    expect(audit).not.toContain("pageNumber");
  });
});

function messagesPrompt() {
  const docs = retriever({
    id: "private-docs",
    namespace: "handbook",
    retrieve: async () => [
      {
        namespace: "handbook",
        source: {
          id: "private.md",
          url: "https://private.example/source",
          path: "/private/source.md",
          location: { type: "page" as const, pageNumber: 4 },
          assetRef: { uri: "memory://asset/private" },
        },
        chunkId: "0",
        content: "private retrieval value",
        metadata: {},
        score: 1,
      },
    ],
    context: { query: "sensitive query" },
  });
  return prompt({
    id: "folded-retrieval-provenance",
    use: [docs.asContext()],
    messages: () => [
      { role: "system" as const, content: "Trusted suffix." },
      { role: "user" as const, content: "Question." },
    ],
  });
}

function replaceFirstSystem(messages: readonly Message[]): Message[] {
  return messages.map((message, index) =>
    index === 0
      ? { ...message, content: "Changed after resolution." }
      : message,
  );
}
