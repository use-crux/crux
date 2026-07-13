import { describe, expect, it } from "vitest";
import {
  matchesMediaCatalogFilter,
  mediaCatalogBadges,
  projectIngestSourceCatalog,
  projectMediaOperationCatalog,
  type MediaCatalogFilter,
} from "./media-catalog";

const FORBIDDEN = [
  "SECRET_URL",
  "SECRET_ID",
  "asset://SECRET",
  "filename.png",
  "data:image",
];

describe("media catalog projection", () => {
  it("projects normalized transcription task without retaining target language", () => {
    const view = projectMediaOperationCatalog({
      id: "media.operation:translate",
      name: "translate",
      kind: "media.operation",
      facts: {
        kind: "media.operation",
        operation: "transcribe",
        authoredOptions: {
          task: "translate",
          targetLanguage: "SECRET_LANGUAGE",
        },
      },
    });

    expect(view?.authoredOptions).toEqual({ task: "translate" });
    expect(JSON.stringify(view)).not.toContain("SECRET_LANGUAGE");
  });

  it("projects media.operation cards with modalities, execution, and options", () => {
    const view = projectMediaOperationCatalog({
      id: "media.operation:cover",
      name: "cover",
      kind: "media.operation",
      fidelity: "resolved",
      file: "src/media.ts",
      line: 12,
      warningCount: 1,
      facts: {
        kind: "media.operation",
        operation: "generateImage",
        outputModalities: ["image"],
        adapter: "google",
        model: "imagen-3",
        execution: "unknown",
        authoredOptions: { n: 2, size: "1024x1024" },
        fileId: "SECRET_ID",
        url: "https://example.com/SECRET_URL",
      },
      relations: [
        {
          id: "r1",
          type: "media.uses_routing",
          direction: "from",
          otherId: "routing.router:vision",
          otherKind: "routing.router",
          otherName: "vision",
        },
      ],
    });

    expect(view).toEqual({
      kind: "media.operation",
      id: "media.operation:cover",
      name: "cover",
      operation: "generateImage",
      inputModalities: [],
      outputModalities: ["image"],
      adapter: "google",
      model: "imagen-3",
      execution: "unknown",
      authoredOptions: { n: 2, size: "1024x1024" },
      sourceFile: "src/media.ts",
      sourceLine: 12,
      fidelity: "resolved",
      warningCount: 1,
      relations: [
        expect.objectContaining({ type: "media.uses_routing" }),
      ],
    });
    expect(mediaCatalogBadges(view!)).toEqual(
      expect.arrayContaining([
        "generateImage",
        "unknown support",
        "out:image",
        "google",
        "imagen-3",
        "1 warnings",
      ]),
    );
    const serialized = JSON.stringify(view);
    for (const token of FORBIDDEN) {
      expect(serialized).not.toContain(token);
    }
  });

  it("projects ingest.source cards without locators and keeps unknown distinct", () => {
    const view = projectIngestSourceCatalog({
      id: "ingest.source:uploads",
      name: "uploads",
      kind: "ingest.source",
      facts: {
        kind: "ingest.source",
        sourceKind: "file",
        mediaKinds: ["image", "audio", "document"],
        namespace: "docs",
        attribution: ["page", "time"],
        path: "/SECRET/path",
        url: "https://example.com/SECRET_URL",
      },
    });
    expect(view).toMatchObject({
      kind: "ingest.source",
      sourceKind: "file",
      mediaKinds: ["image", "audio", "document"],
      namespace: "docs",
      attribution: ["page", "time"],
    });
    expect(JSON.stringify(view)).not.toContain("SECRET");
    expect(
      projectMediaOperationCatalog({
        id: "x",
        name: "x",
        kind: "media.operation",
        facts: { operation: "transcribe" },
      })?.execution,
    ).toBe("unknown");
  });

  it.each([
    ["media", true],
    ["images", true],
    ["audio", false],
    ["generated-media", true],
    ["transcription", false],
    ["native", false],
    ["unknown-support", true],
    ["has-warnings", true],
  ] as const satisfies ReadonlyArray<readonly [MediaCatalogFilter, boolean]>)(
    "filter %s matches expected for generated image card",
    (filter, expected) => {
      const view = projectMediaOperationCatalog({
        id: "media.operation:cover",
        name: "cover",
        kind: "media.operation",
        warningCount: 2,
        facts: {
          operation: "generateImage",
          outputModalities: ["image"],
          execution: "unknown",
        },
      })!;
      expect(matchesMediaCatalogFilter(view, filter)).toBe(expected);
    },
  );

  it("filters transcription, speech, composed, and ingest sources", () => {
    const transcription = projectMediaOperationCatalog({
      id: "t",
      name: "t",
      kind: "media.operation",
      facts: {
        operation: "transcribe",
        inputModalities: ["audio"],
        outputModalities: ["text"],
        execution: "composed",
      },
    })!;
    const speech = projectMediaOperationCatalog({
      id: "s",
      name: "s",
      kind: "media.operation",
      facts: {
        operation: "generateSpeech",
        outputModalities: ["audio"],
        execution: "native",
      },
    })!;
    const ingest = projectIngestSourceCatalog({
      id: "i",
      name: "i",
      kind: "ingest.source",
      facts: { sourceKind: "url", mediaKinds: ["video"] },
    })!;

    expect(matchesMediaCatalogFilter(transcription, "transcription")).toBe(
      true,
    );
    expect(matchesMediaCatalogFilter(transcription, "composed")).toBe(true);
    expect(matchesMediaCatalogFilter(speech, "speech")).toBe(true);
    expect(matchesMediaCatalogFilter(speech, "native")).toBe(true);
    expect(matchesMediaCatalogFilter(ingest, "ingest-sources")).toBe(true);
    expect(matchesMediaCatalogFilter(ingest, "video")).toBe(true);
    expect(matchesMediaCatalogFilter(ingest, "documents")).toBe(false);
  });
});
