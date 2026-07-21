import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

describe("first-party Phase 7 native fixture parity", () => {
  itWithRustOxc(
    "emits deferred as the effective mode when memory capture config is omitted",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: "export const sessionMemory = memory({ id: 'session', blocks: [] })",
        callNames: ["memory"],
      });

      const metadata = nativeOut.definitions.find(
        (definition) => definition.id === "memory:session",
      )?.metadata;
      expect(metadata).toMatchObject({
        captureMode: "deferred",
        facts: { captureMode: "deferred" },
      });
    },
    30_000,
  );

  itWithRustOxc(
    "emits only closed effective modes for explicit and removed capture syntax",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "export const inlineMemory = memory({ id: 'inline', capture: { mode: 'inline' }, blocks: [] })",
          "export const deferredMemory = memory({ id: 'deferred', capture: { mode: 'deferred' }, blocks: [] })",
          "export const removedCaptureMemory = memory({ id: 'removed-capture', capture: { mode: 'afterResponse' }, blocks: [] })",
          "export const removedProcessingMemory = memory({ id: 'removed-processing', processing: { mode: 'manual' }, blocks: [] })",
        ].join("\n"),
        callNames: ["memory"],
      });

      const captureModes = Object.fromEntries(
        nativeOut.definitions
          .filter((definition) => definition.kind === "memory")
          .map((definition) => [
            definition.id,
            {
              metadata: definition.metadata?.captureMode,
              facts: captureModeFromFacts(definition.metadata?.facts),
            },
          ]),
      );
      expect(captureModes).toEqual({
        "memory:inline": { metadata: "inline", facts: "inline" },
        "memory:deferred": { metadata: "deferred", facts: "deferred" },
        "memory:removed-capture": {
          metadata: "deferred",
          facts: "deferred",
        },
        "memory:removed-processing": {
          metadata: "deferred",
          facts: "deferred",
        },
      });
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native memory facts from Rust/Oxc records",
    async () => {
      const source = [
        "const memoryId = createMemoryId('session')",
        "const stateSchema = z.object({ userId: z.string(), turnCount: z.number().optional() })",
        "const memoryStore = durableStore({ component: components.memory })",
        "",
        "export const sessionMemory = memory({",
        "  id: memoryId,",
        "  capture: { mode: 'deferred' },",
        "  budget: { maxTokens: 1200 },",
        "  evictionPolicy: 'ttl-30d',",
        "  store: memoryStore,",
        "  blocks: [",
        "    workingState({ id: 'state', schema: stateSchema, priority: 10, budget: { maxTokens: 300 }, write: { mode: 'merge' } }),",
        "    episodes({ id: 'history', embed: embedEpisode, priority: 5, retention: '30d', render: { strategy: 'recent', limit: 4 } }),",
        "    memoryBlock({ id: 'scratch', kind: 'custom', render: false }),",
        "  ],",
        "})",
      ].join("\n");
      const { nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: [
            "memory",
            "createMemoryId",
            "workingState",
            "episodes",
            "memoryBlock",
            "durableStore",
          ],
        },
      );

      expect(nativeFactCount(record, "memory")).toBe(1);
      expect(nativeOut.definitions.map((definition) => definition.id)).toEqual(
        expect.arrayContaining([
          "memory:session",
          "memory.block:session:state",
          "memory.block:session:history",
          "memory.block:session:scratch",
          "memory.store:session:memoryStore",
        ]),
      );
      expect(
        nativeOut.definitions.find(
          (definition) => definition.id === "memory:session",
        )?.metadata,
      ).toMatchObject({
        blockCount: 3,
        captureMode: "deferred",
        facts: { captureMode: "deferred" },
      });
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native blackboard facts from Rust/Oxc records",
    async () => {
      const source = [
        "const boardId = createMemoryId('blackboard')",
        "const boardSchema = z.object({ topic: z.string(), status: z.string() })",
        "",
        "export const sharedBoard = blackboard({",
        "  id: boardId,",
        "  schema: boardSchema,",
        "  conflictPolicy: 'last-writer-wins',",
        "  store: durableStore({ component: components.memory }),",
        "})",
      ].join("\n");
      const { nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: ["blackboard", "createMemoryId"],
        },
      );

      expect(nativeFactCount(record, "blackboard")).toBe(1);
      expect(
        nativeOut.definitions.filter(
          (definition) => definition.kind === "blackboard",
        ),
      ).toHaveLength(1);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native routing facts from Rust/Oxc records",
    async () => {
      const source = [
        "export const writerPrompt = prompt({ id: 'writer-routing' })",
        "export const backupPrompt = prompt({ id: 'backup-routing' })",
        "export const writerAgent = agent({ id: 'writer-routing-agent', prompt: writerPrompt })",
        "",
        "export const retriedWriter = retry(writerAgent, { id: 'retried-writer', attempts: 2 })",
        "export const resilientWriter = fallback([retriedWriter, backupPrompt], { id: 'resilient-writer' })",
        "export const canarySplit = split({",
        "  id: 'canary-split',",
        "  seed: () => 'session-1',",
        "  routes: { stable: { model: writerAgent, weight: 95 }, canary: { model: backupPrompt, weight: 5 } },",
        "})",
        "export const qualityCascade = cascade({",
        "  id: 'quality-routing',",
        "  tiers: [",
        "    { model: canarySplit },",
        "    { model: resilientWriter },",
        "  ],",
        "})",
        "export const qualityRouter = router({",
        "  id: 'quality-router',",
        "  routes: { writer: { model: qualityCascade, maxTokens: 1200 }, backup: resilientWriter },",
        "  classify: () => 'writer',",
        "})",
      ].join("\n");
      const { nativeOut, record } = await extractNativeAndFallback(
        {
          source,
          callNames: [
            "prompt",
            "agent",
            "retry",
            "fallback",
            "split",
            "cascade",
            "router",
          ],
        },
      );

      expect(nativeFactCount(record, "routing")).toBe(5);
      expect(nativeOut.definitions.map((definition) => definition.id)).toEqual(
        expect.arrayContaining([
          "routing.retry:retried-writer",
          "routing.fallback:resilient-writer",
          "routing.split:canary-split",
          "routing.cascade:quality-routing",
          "routing.router:quality-router",
        ]),
      );
    },
    30_000,
  );
});

function captureModeFromFacts(facts: unknown): unknown {
  return facts && typeof facts === "object" && "captureMode" in facts
    ? facts.captureMode
    : undefined;
}
