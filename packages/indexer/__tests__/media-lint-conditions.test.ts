import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import { semanticIndexFacts } from "../src/indexer/semantic/evidence/facts";
import { mediaArchitectureLintFindings } from "../src/indexer/semantic/media-lints";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("deterministic media lint conditions", () => {
  it("emits capability and raw-retention findings only for manifest-proven retained shapes", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-media-lints-"));
    roots.push(root);
    const file = join(root, "media.ts");
    await writeFile(
      file,
      `
      import { generate, generateImage } from '@use-crux/ai'
      declare const image: unknown
      export const unsupported = generateImage({ adapter: 'anthropic' })
      export const retained = generateImage({ adapter: 'google', observability: { metadata: { rawMedia: image } } })
      export const unknown = generateImage({ adapter: 'custom' })
      export const notRetained = generateImage({ adapter: 'google', request: { rawMedia: image } })
      export const matchingProvider = generate({ adapter: 'google', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'provider-file', provider: 'google', fileId: 'safe-provider-file' } }] }] })
      export const hydrated = generate({ adapter: 'google', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'data', data: 'bounded-data' } }] }] })
      void unsupported.content
      void retained.content
      void unknown.content
      void notRetained.content
      void matchingProvider.content
      void hydrated.messages
    `,
    );

    const rules = semanticIndexFacts(root, [file]).lintFindings?.map(
      (finding) => [finding.ruleId, finding.primaryDefinitionId],
    );
    expect(rules).toContainEqual([
      "media.unsupported-capability",
      "media.operation:unsupported",
    ]);
    expect(rules).toContainEqual([
      "media.raw-retention",
      "media.operation:retained",
    ]);
    expect(rules).not.toContainEqual([
      "media.unsupported-capability",
      "media.operation:unknown",
    ]);
    expect(rules).not.toContainEqual([
      "media.raw-retention",
      "media.operation:notRetained",
    ]);
    expect(rules).not.toContainEqual([
      "media.invalid-provider-file",
      "media.operation:matchingProvider",
    ]);
    expect(rules).not.toContainEqual([
      "media.asset-ref-not-hydrated",
      "media.operation:hydrated",
    ]);
    expect(rules).not.toContainEqual([
      "media.output-discarded",
      "media.operation:matchingProvider",
    ]);
    expect(rules).not.toContainEqual([
      "media.output-discarded",
      "media.operation:hydrated",
    ]);
  });

  it("emits missing derivation and attribution only from conclusive graph evidence", () => {
    const source = { file: "src/ingest.ts", line: 4 };
    const definitions: ProjectDefinition[] = [
      ingest("ingest.source:missing", ["image"], ["page"], source),
      ingest("ingest.source:preserved", ["audio"], ["time"], source),
      ingest("ingest.source:lost", ["document"], ["page"], source),
      ingest("ingest.source:text", ["text"], [], source),
    ];
    const relations: ProjectRelation[] = [
      derivation("ingest.source:preserved", true),
      derivation("ingest.source:lost", false),
    ];

    const rules = mediaArchitectureLintFindings(definitions, relations).map(
      (finding) => [finding.ruleId, finding.primaryDefinitionId],
    );
    expect(rules).toContainEqual([
      "media.missing-derivation",
      "ingest.source:missing",
    ]);
    expect(rules).toContainEqual([
      "media.missing-attribution",
      "ingest.source:lost",
    ]);
    expect(rules).not.toContainEqual([
      "media.missing-derivation",
      "ingest.source:text",
    ]);
    expect(rules).not.toContainEqual([
      "media.missing-attribution",
      "ingest.source:preserved",
    ]);
  });
});

function ingest(
  id: string,
  mediaKinds: string[],
  attribution: string[],
  source: { file: string; line: number },
): ProjectDefinition {
  return {
    id,
    kind: "ingest.source",
    name: id,
    source,
    fidelity: "resolved",
    status: "active",
    metadata: {
      facts: {
        kind: "ingest.source",
        sourceKind: "file",
        mediaKinds,
        attribution,
      },
    },
  };
}

function derivation(
  from: string,
  attributionPreserved: boolean,
): ProjectRelation {
  return {
    id: `media.derives_with:${from}`,
    type: "media.derives_with",
    from,
    to: "media.operation:derive",
    fidelity: "resolved",
    metadata: { attributionPreserved },
  };
}
