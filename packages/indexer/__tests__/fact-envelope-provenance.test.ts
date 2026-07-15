import { describe, expect, it } from "vitest";
import type {
  IndexDiagnostic,
  ProjectDefinition,
} from "@use-crux/core/project-index";
import { nativeFinalizeFactsFromExtractionResults } from "../src/indexer/static-index/extension-host/evidence/host-facts";
import type { StaticExtractionResult } from "../src/indexer/extensions/runtime/engine";
import type { IndexPatch } from "../src/indexer/patches";
import {
  factEnvelopesFromIndexPatch,
  indexPatchFromWorkerEvents,
  indexPatchToWorkerEvents,
} from "../src/indexer/worker-protocol/patch-events";

const writer: ProjectDefinition = {
  id: "prompt:writer",
  kind: "prompt",
  name: "writer",
  fidelity: "resolved",
  status: "active",
};

const extractorDiagnostic: IndexDiagnostic = {
  id: "diagnostic:writer",
  severity: "warning",
  code: "extension.writer_partial",
  message: "Writer metadata is partial.",
};

describe("fact envelope extractor provenance", () => {
  it("retains every actual extension result contributor in canonical order", () => {
    const facts = nativeFinalizeFactsFromExtractionResults([
      extractionResult("@scope/z-extension", "2.0.0", "zeta"),
      extractionResult("@scope/a-extension", "1.0.0", "alpha"),
      extractionResult("@scope/a-extension", "1.0.0", "alpha"),
      extractionResult("@use-crux/indexer/crux-core", "0.5.0", "prompt"),
      extractionResult(
        "@use-crux/indexer/crux-core-media",
        "2",
        "media.operation",
      ),
    ]);

    expect(facts.definitionExtractors).toEqual({
      "prompt:writer": [
        { name: "media.operation" },
        { name: "prompt" },
        {
          name: "alpha",
          extension: { name: "@scope/a-extension", version: "1.0.0" },
        },
        {
          name: "zeta",
          extension: { name: "@scope/z-extension", version: "2.0.0" },
        },
      ],
    });
  });

  it("attributes only the definitions, relation refs, source refs, and diagnostics emitted by each extractor", () => {
    const contributor = {
      name: "writer.extractor",
      extension: { name: "@scope/writer-extension", version: "1.2.3" },
    };
    const facts = nativeFinalizeFactsFromExtractionResults([
      extractionResult("@scope/writer-extension", "1.2.3", "writer.extractor", {
        definitions: [{ variableName: "writer", definition: writer }],
        references: [
          {
            type: "prompt.uses_context",
            fromId: writer.id,
            toId: "context:brand",
          },
        ],
        sourceRefs: [
          {
            definitionId: writer.id,
            ref: {
              id: "source-ref:writer-schema",
              role: "schema",
              source: { file: "src/writer.ts", line: 2, column: 3 },
              fidelity: "resolved",
            },
          },
        ],
        diagnostics: [extractorDiagnostic],
      }),
      extractionResult(
        "@scope/empty-extension",
        "9.9.9",
        "empty.extractor",
        {},
      ),
    ]);

    expect(facts.factExtractors).toEqual({
      "definitions:prompt:writer": [contributor],
      "diagnostics:diagnostic:writer": [contributor],
      "sourceRefs:prompt:writer:source-ref:writer-schema": [contributor],
    });
    expect(facts.relationRefs).toEqual([
      {
        ownerDefinitionId: writer.id,
        type: "prompt.uses_context",
        fromId: writer.id,
        toId: "context:brand",
        extractors: [contributor],
      },
    ]);
    expect(JSON.stringify(facts)).not.toContain("empty.extractor");
  });

  it("moves canonical attribution onto definition envelopes without changing the fact", () => {
    const patch = {
      schemaVersion: 1,
      phase: "ast",
      project: { root: "/repo" },
      startedAt: "2026-07-15T00:00:00.000Z",
      status: "ok",
      definitionExtractors: {
        "prompt:writer": [
          {
            name: "zeta",
            extension: { name: "@scope/z-extension", version: "2.0.0" },
          },
          { name: "prompt" },
        ],
      },
      facts: { definitions: [writer] },
    } satisfies IndexPatch;

    const [envelope] = factEnvelopesFromIndexPatch(patch, {
      name: "@use-crux/indexer/project-indexer",
      version: "0.5.0",
    });

    expect(envelope?.producer).toEqual({
      name: "@use-crux/indexer/project-indexer",
      version: "0.5.0",
    });
    expect(envelope?.provenance.extractors).toEqual([
      { name: "prompt" },
      {
        name: "zeta",
        extension: { name: "@scope/z-extension", version: "2.0.0" },
      },
    ]);
    expect(envelope?.fact).toEqual(writer);
  });

  it("moves exact attribution onto every mapped non-definition envelope and omits legacy/unmapped attribution", () => {
    const contributor = {
      name: "writer.extractor",
      extension: { name: "@scope/writer-extension", version: "1.2.3" },
    };
    const relation = {
      id: "relation:prompt.uses_context:prompt:writer:context:brand",
      type: "prompt.uses_context",
      from: writer.id,
      to: "context:brand",
      fidelity: "resolved",
    } as const;
    const sourceRef = {
      definitionId: writer.id,
      ref: {
        id: "source-ref:writer-schema",
        role: "schema",
        source: { file: "src/writer.ts", line: 2, column: 3 },
        fidelity: "resolved",
      },
    } as const;
    const patch = {
      schemaVersion: 1,
      phase: "ast",
      project: { root: "/repo" },
      startedAt: "2026-07-15T00:00:00.000Z",
      status: "ok",
      factExtractors: {
        [`definitions:${writer.id}`]: [contributor],
        [`relations:${relation.id}`]: [contributor],
        [`sourceRefs:${sourceRef.definitionId}:${sourceRef.ref.id}`]: [
          contributor,
        ],
        [`diagnostics:${extractorDiagnostic.id}`]: [contributor],
      },
      facts: {
        definitions: [writer],
        relations: [relation],
        sourceRefs: [sourceRef],
        diagnostics: [
          extractorDiagnostic,
          {
            id: "diagnostic:compiler",
            severity: "info",
            code: "compiler.note",
            message: "Compiler note.",
          },
        ],
      },
    } satisfies IndexPatch;

    const envelopes = factEnvelopesFromIndexPatch(patch, {
      name: "@use-crux/indexer/project-indexer",
      version: "0.5.0",
    });
    const byFactId = new Map(
      envelopes.map((envelope) => [envelope.factId, envelope]),
    );

    expect(
      byFactId.get(`definitions:${writer.id}`)?.provenance.extractors,
    ).toEqual([contributor]);
    expect(
      byFactId.get(`relations:${relation.id}`)?.provenance.extractors,
    ).toEqual([contributor]);
    expect(byFactId.get("sourceRefs:0")?.provenance.extractors).toEqual([
      contributor,
    ]);
    expect(
      byFactId.get(`diagnostics:${extractorDiagnostic.id}`)?.provenance
        .extractors,
    ).toEqual([contributor]);
    expect(
      byFactId.get("diagnostics:diagnostic:compiler")?.provenance.extractors,
    ).toBeUndefined();
  });

  it("reconstructs canonical extractor maps so worker round-trip re-emission retains exact attribution", () => {
    const contributor = {
      name: "writer.extractor",
      extension: { name: "@scope/writer-extension", version: "1.2.3" },
    };
    const relation = {
      id: "relation:prompt.uses_context:prompt:writer:context:brand",
      type: "prompt.uses_context",
      from: writer.id,
      to: "context:brand",
      fidelity: "resolved",
    } as const;
    const sourceRef = {
      definitionId: writer.id,
      ref: {
        id: "source-ref:writer-schema",
        role: "schema",
        source: { file: "src/writer.ts", line: 2, column: 3 },
        fidelity: "resolved",
      },
    } as const;
    const patch = {
      schemaVersion: 1,
      phase: "ast",
      project: { root: "/repo" },
      startedAt: "2026-07-15T00:00:00.000Z",
      status: "ok",
      factExtractors: {
        [`definitions:${writer.id}`]: [contributor],
        [`relations:${relation.id}`]: [contributor],
        [`sourceRefs:${sourceRef.definitionId}:${sourceRef.ref.id}`]: [
          contributor,
        ],
        [`diagnostics:${extractorDiagnostic.id}`]: [contributor],
      },
      facts: {
        definitions: [writer],
        relations: [relation],
        sourceRefs: [sourceRef],
        diagnostics: [extractorDiagnostic],
      },
    } satisfies IndexPatch;
    const producer = {
      name: "@use-crux/indexer/project-indexer",
      version: "0.5.0",
    };

    const reconstructed = indexPatchFromWorkerEvents(
      indexPatchToWorkerEvents(patch, {
        transactionId: "round-trip",
        producer,
      }),
    );

    expect(reconstructed.definitionExtractors).toEqual({
      [writer.id]: [contributor],
    });
    expect(reconstructed.factExtractors).toEqual(patch.factExtractors);
    expect(
      factEnvelopesFromIndexPatch(reconstructed, producer).map((envelope) => [
        envelope.factId,
        envelope.provenance.extractors,
      ]),
    ).toEqual(
      factEnvelopesFromIndexPatch(patch, producer).map((envelope) => [
        envelope.factId,
        envelope.provenance.extractors,
      ]),
    );
  });

  it.each(["", "bad\nextractor"])(
    "rejects unsafe extractor identity %j",
    (name) => {
      const patch = {
        schemaVersion: 1,
        phase: "ast",
        project: { root: "/repo" },
        startedAt: "2026-07-15T00:00:00.000Z",
        status: "ok",
        definitionExtractors: { "prompt:writer": [{ name }] },
        facts: { definitions: [writer] },
      } satisfies IndexPatch;

      expect(() =>
        factEnvelopesFromIndexPatch(patch, {
          name: "@use-crux/indexer/project-indexer",
          version: "0.5.0",
        }),
      ).toThrow(/extractor/i);
    },
  );

  it("sorts contributor fields by UTF-8 bytes across the non-BMP boundary", () => {
    const facts = nativeFinalizeFactsFromExtractionResults([
      extractionResult("@scope/extension", "1.0.0", "\u{10000}"),
      extractionResult("@scope/extension", "1.0.0", "\uE000"),
    ]);

    expect(
      facts.definitionExtractors?.["prompt:writer"]?.map((item) => item.name),
    ).toEqual(["\uE000", "\u{10000}"]);
  });

  it("rejects malformed Unicode identities before JSON transport", () => {
    expect(() =>
      nativeFinalizeFactsFromExtractionResults([
        extractionResult("@scope/extension", "1.0.0", "\uD800"),
      ]),
    ).toThrow(/extractor/i);
  });
});

function extractionResult(
  extension: string,
  version: string,
  extractor: string,
  facts: Extract<
    StaticExtractionResult,
    { readonly kind: "matched" }
  >["facts"] = {
    definitions: [{ variableName: "writer", definition: writer }],
  },
): StaticExtractionResult {
  return {
    kind: "matched",
    extension: { name: extension, version },
    extractor,
    dependencies: [],
    diagnostics: [],
    facts,
  };
}
