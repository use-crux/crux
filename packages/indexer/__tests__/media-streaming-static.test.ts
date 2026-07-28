import { describe, expect, it } from "vitest";
import {
  createStaticExtraction,
  type SourceReader,
} from "../src/indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";

describe("bounded media streaming static indexing", () => {
  it("projects native modalities and safe options without media payloads", async () => {
    const extracted = await extract(
      [
        `import { streamImage } from '@use-crux/openai'`,
        `import { streamSpeech } from '@use-crux/google'`,
        `import { guardrail } from '@use-crux/core/safety'`,
        `const imagePolicy = guardrail({ id: 'image-policy' })`,
        `const streamSafety = { mode: 'enforce' }`,
        `export const image = streamImage({ model: 'gpt-image-1', prompt: 'SECRET_PROMPT', n: 1, size: '1024x1024', guardrails: [imagePolicy], safety: streamSafety, extra: { url: 'https://secret.example' } })`,
        `export const speech = streamSpeech({ model: 'gemini-3.1-flash-tts-preview', text: 'SECRET_SPEECH', voice: 'Kore' })`,
      ].join("\n"),
    );

    expect(
      extracted.definitions
        .filter((definition) => definition.kind === "media.operation")
        .map((definition) => definition.metadata?.facts),
    ).toEqual([
      {
        kind: "media.operation",
        operation: "streamImage",
        outputModalities: ["image"],
        adapter: "openai",
        model: "gpt-image-1",
        execution: "native",
        authoredOptions: { n: 1, size: "1024x1024" },
      },
      {
        kind: "media.operation",
        operation: "streamSpeech",
        inputModalities: ["text"],
        outputModalities: ["audio"],
        adapter: "google",
        model: "gemini-3.1-flash-tts-preview",
        execution: "native",
        authoredOptions: { voice: "Kore" },
      },
    ]);
    expect(JSON.stringify(extracted)).not.toMatch(
      /SECRET_PROMPT|SECRET_SPEECH|secret\.example/,
    );
    expect(extracted.relations).not.toContainEqual(
      expect.objectContaining({
        type: "guardrail.applies_to",
        from: "media.operation:image",
        to: "media.operation:image",
      }),
    );
  });
});

async function extract(source: string) {
  const file = "/fixture/media-streaming.ts";
  const reader: SourceReader = {
    read: async (requested) => {
      if (requested !== file) throw new Error(`Unexpected source: ${requested}`);
      return source;
    },
  };
  return createStaticExtraction({
    root: "/fixture",
    cache: "none",
    sources: reader,
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
  }).extractFile(file);
}
