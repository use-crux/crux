/** Focused behavior coverage for direct retrieval model ingress. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { CallArgs } from "../../src/adapter/types";
import { context } from "../../src/prompt/context";
import { prompt } from "../../src/prompt/prompt";
import { retriever } from "../../src/retrieval";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";
import { capturingRetrievalAdapter } from "./retrieval-input-safety.fixture";

describe("direct retrieval input safety behavior", () => {
  it("guards text introduced only by a custom renderer under retrieval provenance", async () => {
    const calls: CallArgs[] = [];
    const userSeen: string[] = [];
    let retrievalRuns = 0;
    const docs = retriever({
      id: "custom-renderer",
      namespace: "handbook",
      retrieve: async () => [hit("original hit text")],
      context: { query: "custom" },
    });
    const answer = prompt({
      id: "custom-renderer-safety",
      use: [
        docs.asContext({
          renderContext: () => "renderer-only private text",
        }),
      ],
      prompt: "Answer.",
    });

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      guardrails: [
        guardrail({
          id: "user-only",
          on: boundary.input.text({ from: "user" }),
          run: (text) => {
            userSeen.push(text);
            return { action: "allow" };
          },
        }),
        guardrail({
          id: "retrieval-only",
          on: boundary.input.text({ from: "retrieval" }),
          run: (text) => {
            retrievalRuns++;
            expect(text).toBe("renderer-only private text");
            return {
              action: "rewrite",
              value: "renderer-only safe text",
              rewrite: { kind: "redact" },
            };
          },
        }),
      ],
    });

    expect(userSeen).toEqual(["Answer."]);
    expect(retrievalRuns).toBe(1);
    expect(calls[0]?.system).toBe("renderer-only safe text");
  });

  it("evaluates trusted and retrieval contributions once without changing their order", async () => {
    const calls: CallArgs[] = [];
    const instructionsSeen: string[] = [];
    const retrievalSeen: string[] = [];
    const docs = retriever({
      id: "mixed-docs",
      namespace: "handbook",
      retrieve: async () => [hit("private middle")],
      context: { query: "mixed" },
    });
    const trustedAfter = context({
      id: "trusted-after",
      system: "Trusted after.",
    });
    const answer = prompt({
      id: "mixed-retrieval-safety",
      system: "Trusted before.",
      use: [docs.asContext(), trustedAfter],
      prompt: "Answer.",
    });

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      guardrails: [
        guardrail({
          id: "inspect-instructions",
          on: boundary.input.instructions(),
          run: (text) => {
            instructionsSeen.push(text);
            return { action: "allow" };
          },
        }),
        guardrail({
          id: "rewrite-middle",
          on: boundary.input.text({ from: "retrieval" }),
          run: (text) => {
            retrievalSeen.push(text);
            return {
              action: "rewrite",
              value: text.replace("private middle", "safe middle"),
              rewrite: { kind: "redact" },
            };
          },
        }),
      ],
    });

    expect(instructionsSeen).toEqual(["Trusted before.", "Trusted after."]);
    expect(retrievalSeen).toEqual([
      "## Retrieved Context (mixed)\n" +
        "- [source.md/chunk-0] (score: 0.90) private middle",
    ]);
    expect(calls[0]?.system).toBe(
      "Trusted before.\n\n" +
        "## Retrieved Context (mixed)\n" +
        "- [source.md/chunk-0] (score: 0.90) safe middle\n\n" +
        "Trusted after.",
    );
    expect(calls[0]?.systemBlocks).toBeUndefined();
  });

  it("blocks direct retrieval before invoking the provider", async () => {
    const calls: CallArgs[] = [];
    const docs = retriever({
      id: "blocked-docs",
      namespace: "handbook",
      retrieve: async () => [hit("blocked retrieval")],
      context: { query: "blocked" },
    });
    const answer = prompt({
      id: "blocked-retrieval-safety",
      use: [docs.asContext()],
      prompt: "Answer.",
    });

    await expect(
      adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
        model: "test-model",
        guardrails: [
          guardrail({
            id: "block-retrieval",
            on: boundary.input.text({ from: "retrieval" }),
            run: () => ({ action: "block", reason: "unsafe retrieval" }),
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);
    expect(calls).toHaveLength(0);
  });

  it("routes provider adaptations as instructions beside retrieval text", async () => {
    const calls: CallArgs[] = [];
    const instructionsSeen: string[] = [];
    const docs = retriever({
      id: "adapted-docs",
      namespace: "handbook",
      retrieve: async () => [hit("retrieval under adaptation")],
      context: { query: "adapted" },
    });
    const answer = prompt({
      id: "adapted-retrieval-safety",
      system: "Base instructions.",
      use: [docs.asContext()],
      prompt: "Answer.",
      adapt: {
        "retrieval-input-safety": {
          prependSystem: "Provider head.",
          appendSystem: "Provider tail.",
        },
      },
    });

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      guardrails: [
        guardrail({
          id: "inspect-adapted-instructions",
          on: boundary.input.instructions(),
          run: (text) => {
            instructionsSeen.push(text);
            return { action: "allow" };
          },
        }),
        guardrail({
          id: "inspect-adapted-retrieval",
          on: boundary.input.text({ from: "retrieval" }),
          run: () => ({ action: "allow" }),
        }),
      ],
    });

    expect(instructionsSeen).toEqual([
      "Base instructions.",
      "Provider head.",
      "Provider tail.",
    ]);
    expect(calls[0]?.system).toContain("retrieval under adaptation");
  });
});

function hit(content: string) {
  return {
    namespace: "handbook",
    source: { id: "source.md" },
    chunkId: "chunk-0",
    content,
    metadata: {},
    score: 0.9,
  };
}
