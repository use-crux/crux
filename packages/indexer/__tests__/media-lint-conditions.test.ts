import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import {
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";
import { mediaArchitectureLintFindings } from "../src/indexer/semantic/media-lints";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("deterministic media lint conditions", () => {
  it("emits media-input findings only from provider and source evidence", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-media-lints-"));
    roots.push(root);
    const scope = join(root, "node_modules/@use-crux");
    await mkdir(scope, { recursive: true });
    await Promise.all(
      ["ai", "core", "openai"].map((name) =>
        symlink(join(process.cwd(), `../${name}`), join(scope, name), "dir"),
      ),
    );
    await Promise.all([
      symlink(
        join(process.cwd(), "../ai/node_modules/ai"),
        join(root, "node_modules/ai"),
        "dir",
      ),
      symlink(
        join(process.cwd(), "../openai/node_modules/openai"),
        join(root, "node_modules/openai"),
        "dir",
      ),
    ]);
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2022",
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["media.ts"],
      }),
    );
    const file = join(root, "media.ts");
    await writeFile(
      file,
      `
      import { generate } from '@use-crux/ai'
      import { prompt } from '@use-crux/core'
      import { createOpenAI } from '@use-crux/openai'
      import type { LanguageModel } from 'ai'
      import type OpenAI from 'openai'
      declare const client: OpenAI
      declare const model: LanguageModel
      const openai = createOpenAI(client)
      const visionPrompt = prompt({ id: 'vision' })
      export const mismatchedProvider = openai.generate(visionPrompt, { model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'provider-file', provider: 'google', fileId: 'safe-provider-file' } }] }] })
      export const matchingProvider = openai.generate(visionPrompt, { model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'provider-file', provider: 'openai', fileId: 'safe-provider-file' } }] }] })
      export const hydrated = generate(visionPrompt, { model, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'data', data: 'bounded-data' } }] }] })
      export const unhydrated = generate(visionPrompt, { model, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'asset-ref', ref: { uri: 'private-ref' } } }] }] })
      void mismatchedProvider.content
      void matchingProvider.content
      void hydrated.messages
    `,
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });
    expect(patch.status).toBe("ok");
    const rules = patch.facts.lintFindings?.map((finding) => [
      finding.ruleId,
      finding.primaryDefinitionId,
    ]);
    expect(rules).toContainEqual([
      "media.invalid-provider-file",
      "media.operation:mismatchedProvider",
    ]);
    expect(rules).not.toContainEqual([
      "media.invalid-provider-file",
      "media.operation:matchingProvider",
    ]);
    expect(rules).not.toContainEqual([
      "media.asset-ref-not-hydrated",
      "media.operation:hydrated",
    ]);
    expect(rules).toContainEqual([
      "media.asset-ref-not-hydrated",
      "media.operation:unhydrated",
    ]);
    expect(rules).not.toContainEqual([
      "media.output-discarded",
      "media.operation:matchingProvider",
    ]);
    expect(rules).toContainEqual([
      "media.output-discarded",
      "media.operation:unhydrated",
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
