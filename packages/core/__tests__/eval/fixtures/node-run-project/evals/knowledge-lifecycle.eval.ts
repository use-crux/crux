import { z } from "zod";
import { evaluate } from "../../../../../src/eval";
import { indexingPipeline, type CruxChunk } from "../../../../../src/indexing";
import {
  assertions,
  communities,
  knowledgeBase,
  relate,
} from "../../../../../src/knowledge";
import type { KnowledgeModel } from "../../../../../src/knowledge/model";
import { inMemoryStorage } from "../../../../../src/storage";

const facts = assertions({
  id: "eval-lifecycle-facts",
  version: 1,
  types: {
    fact: z.object({ id: z.string(), text: z.string() }),
  },
  run: (input, api) => {
    const evidence = {
      kind: "chunk" as const,
      sourceId: input.document.sourceId,
      chunkId: input.chunks[0]?.chunkId ?? "main",
    };
    const current = api.emit(
      "fact",
      { id: "current", text: "Current lifecycle fact" },
      { evidence },
    );
    const prior = api.emit(
      "fact",
      { id: "prior", text: "Prior lifecycle fact" },
      { evidence },
    );
    api.relate("supersedes", current, prior, { evidence });
  },
});

const links = relate({
  id: "eval-lifecycle-links",
  version: 1,
  types: {
    follows: {
      from: ["chunk"],
      to: ["chunk"],
      direction: "directed",
      description: "One lifecycle chunk follows another.",
    },
  },
  run: (input, api) => {
    const [first, second] = input.chunks;
    if (!first || !second) return;
    const from = {
      kind: "chunk" as const,
      sourceId: first.sourceId,
      chunkId: first.chunkId,
    };
    const to = {
      kind: "chunk" as const,
      sourceId: second.sourceId,
      chunkId: second.chunkId,
    };
    api.emit("follows", from, to, { evidence: [from, to] });
  },
});

const owned = new Map<string, ReturnType<typeof knowledgeBase>>();

export async function inspectKnowledgeLifecycle(caseId: string) {
  const docs = owned.get(caseId);
  if (!docs) return undefined;
  return {
    communities: await docs.communities?.status(),
    assertions: (await docs.assertions(facts).list()).items.length,
    inspection: docs.inspect(),
  };
}

export default evaluate({
  id: "knowledge-lifecycle",
  task: async (input: { caseId: string; fail: boolean }) => {
    const storage = inMemoryStorage();
    const docs = knowledgeBase({
      id: `eval-lifecycle-${input.caseId}`,
      storage,
      pipeline: indexingPipeline({ derive: [facts, links] }),
      communities: communities({ model: lifecycleModel }),
    });
    owned.set(input.caseId, docs);

    await docs.index(chunks(docs.namespace));
    const assertionPage = await docs.assertions(facts).list();
    await docs.communities?.prepare();
    const reportPage = await docs.communities?.reports();
    const inspection = docs.inspect();

    if (input.fail) throw new Error("injected knowledge lifecycle failure");
    return {
      assertions: assertionPage.items.length,
      reports: reportPage?.reports.length ?? 0,
      indexedChunks: inspection.lifecycle.indexedChunks,
    };
  },
  cases: [
    { id: "success", input: { caseId: "success", fail: false } },
    { id: "failure", input: { caseId: "failure", fail: true } },
  ],
});

const lifecycleModel = {
  name: "eval-lifecycle-community-model",
  fingerprint: "eval-lifecycle-community-model-v1",
  strategyFingerprint: "",
  generateText: async () =>
    ({ text: "", usage: undefined, response: undefined }) as never,
  generateObject: async (args: { readonly prompt: string }) => {
    if (args.prompt.includes("Extract canonical entity names")) {
      return { object: { mentions: [], related: [] } };
    }
    const match = args.prompt.match(/chunk:([^:\s,\]]+):([^,\]\s]+)/u);
    return {
      object: {
        title: "Lifecycle community",
        summary: "Eval-owned in-memory knowledge completed.",
        findings: match
          ? [
              {
                statement: "Lifecycle knowledge is available.",
                evidence: [
                  { kind: "chunk", sourceId: match[1], chunkId: match[2] },
                ],
              },
            ]
          : [],
      },
    };
  },
} satisfies KnowledgeModel & { readonly strategyFingerprint: string };

function chunks(namespace: string): readonly CruxChunk[] {
  return [
    {
      namespace,
      sourceId: "lifecycle-source",
      chunkId: "first",
      ordinal: 0,
      content: "Lifecycle knowledge begins here.",
      metadata: {},
    },
    {
      namespace,
      sourceId: "lifecycle-source",
      chunkId: "second",
      ordinal: 1,
      content: "Lifecycle knowledge continues here.",
      metadata: {},
    },
  ];
}
