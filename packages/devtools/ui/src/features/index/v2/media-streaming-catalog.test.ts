import { describe, expect, it } from "vitest";
import {
  matchesMediaCatalogFilter,
  mediaCatalogBadges,
  projectMediaOperationCatalog,
  type MediaCatalogFilter,
} from "./media-catalog";

const forbidden = [
  "PRIVATE_PROMPT",
  "PRIVATE_BYTES",
  "data:image/png",
  "https://private.example",
  "private.png",
  "asset://private",
  "PRIVATE_NATIVE_EVENT",
];

describe("bounded media streaming Catalog projection", () => {
  it.each([
    {
      operation: "streamImage",
      inputModalities: [],
      outputModalities: ["image"],
      adapter: "openai",
      filters: ["generated-media", "images", "native"],
    },
    {
      operation: "streamSpeech",
      inputModalities: ["text"],
      outputModalities: ["audio"],
      adapter: "google",
      filters: ["generated-media", "audio", "speech", "native"],
    },
  ] as const)(
    "projects $operation as a safe bounded stream",
    ({ operation, inputModalities, outputModalities, adapter, filters }) => {
      const view = projectMediaOperationCatalog({
        id: `media.operation:${operation}`,
        name: operation,
        kind: "media.operation",
        fidelity: "resolved",
        file: "src/media.ts",
        line: 17,
        warningCount: 1,
        facts: {
          operation,
          inputModalities,
          outputModalities,
          adapter,
          execution: "native",
          authoredOptions: { size: "1024x1024", voice: "alloy" },
          prompt: "PRIVATE_PROMPT",
          bytes: "PRIVATE_BYTES",
          url: "https://private.example",
          filename: "private.png",
          ref: "asset://private",
          raw: { type: "PRIVATE_NATIVE_EVENT" },
        },
        relations: [
          {
            id: `relation:${operation}`,
            type: "guardrail.applies_to",
            direction: "to",
            otherId: "guardrail:safe-media",
            otherName: "safeMedia",
            otherKind: "guardrail",
          },
        ],
      });

      expect(view).toMatchObject({
        operation,
        inputModalities,
        outputModalities,
        adapter,
        execution: "native",
        sourceFile: "src/media.ts",
        sourceLine: 17,
        fidelity: "resolved",
        warningCount: 1,
        relations: [expect.objectContaining({ otherName: "safeMedia" })],
      });
      expect(mediaCatalogBadges(view!)).toContain("bounded media stream");
      for (const filter of filters satisfies readonly MediaCatalogFilter[]) {
        expect(matchesMediaCatalogFilter(view!, filter)).toBe(true);
      }
      const serialized = JSON.stringify(view);
      for (const token of forbidden) expect(serialized).not.toContain(token);
    },
  );

  it("keeps text stream presentation distinct from bounded media streaming", () => {
    const view = projectMediaOperationCatalog({
      id: "media.operation:text",
      name: "text",
      kind: "media.operation",
      facts: {
        operation: "stream",
        inputModalities: ["text"],
        outputModalities: ["text"],
        execution: "native",
      },
    });

    expect(mediaCatalogBadges(view!)).toContain("text stream");
    expect(mediaCatalogBadges(view!)).not.toContain("bounded media stream");
  });
});
