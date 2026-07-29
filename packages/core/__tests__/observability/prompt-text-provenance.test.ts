import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import promptTextRun from "../../src/observability/fixtures/prompt-text-run.json";
import { generationInputPreview } from "../../src/generation/orchestrate-observability";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { md } from "../../src/prompt-text";
import { prompt } from "../../src/prompt/prompt";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("ordinary Run PromptText provenance", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("captures exact mixed, nested, JSON, Unicode, and multiline user-prompt segments", async () => {
    const messagesArtifact = promptTextRun.records.find(
      (record) => record.type === "artifact",
    );
    const fragment = md`Nested ${"値"}`;
    const definition = prompt({
      id: "writer",
      input: z.object({ name: z.string() }),
      prompt: ({ input }) => md`Hello ${input.name}
${fragment}
${md.json({ ready: true })}`,
    });
    const resolved = await definition.resolve({ input: { name: "Ada" } });

    expect(messagesArtifact).toHaveProperty("preview");
    expect(
      generationInputPreview({
        preparedArgs: {},
        input: { name: "Ada" },
        resolved,
      }),
    ).toEqual(messagesArtifact?.preview);
  });

  it("preserves an ordinary string prompt without inventing provenance", async () => {
    const definition = prompt({
      id: "plain",
      prompt: "ordinary string",
    });
    const resolved = await definition.resolve({ input: {} });

    expect(
      generationInputPreview({ preparedArgs: {}, input: {}, resolved }),
    ).toMatchObject({
      prompt: "ordinary string",
    });
    expect(
      generationInputPreview({ preparedArgs: {}, input: {}, resolved }),
    ).not.toHaveProperty("userPrompt");
  });

  it("removes PromptText provenance when input capture is disabled", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });
    updateHooks({ observabilityCapture: { recordInputs: false } });

    await observe.span(
      { name: "writer", primitive: "generation.call" },
      async () => {
        observe.artifact({
          kind: "messages",
          contentType: "application/json",
          encoding: "json",
          preview: promptTextMessagesPreview(),
        });
      },
    );
    await observe.flush();

    expect(JSON.stringify(transport.records)).not.toContain("Hello Ada");
    expect(JSON.stringify(transport.records)).not.toContain("userPrompt");
  });

  it("passes PromptText only through the established last-mile redactor", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });
    updateHooks({
      observabilityCapture: {
        redactRecord: (record) =>
          record.type === "artifact" && record.kind === "messages"
            ? { ...record, preview: { redacted: true } }
            : record,
      },
    });

    await observe.span(
      { name: "writer", primitive: "generation.call" },
      async () => {
        observe.artifact({
          kind: "messages",
          contentType: "application/json",
          encoding: "json",
          preview: promptTextMessagesPreview(),
        });
      },
    );
    await observe.flush();

    expect(JSON.stringify(transport.records)).not.toContain("Hello Ada");
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "messages",
        preview: { redacted: true },
      }),
    );
  });
});

function promptTextMessagesPreview(): unknown {
  const record = promptTextRun.records.find(
    (candidate) => candidate.type === "artifact",
  );
  if (!record || !("preview" in record)) {
    throw new Error("PromptText observability fixture is missing");
  }
  return record.preview;
}
