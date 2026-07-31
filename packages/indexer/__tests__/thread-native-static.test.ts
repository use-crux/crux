import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
  jsonStable,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";
import type { StaticFileExtraction } from "../src/indexer/static/extraction/engine";

describe("thread native static projection", () => {
  itWithRustOxc(
    "projects exported definitions and prompt bindings with runtime join metadata",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["thread", "prompt"],
        callInterests: [
          {
            name: "thread",
            importFrom: ["@use-crux/core/thread"],
          },
          {
            name: "prompt",
            importFrom: ["@use-crux/core"],
          },
        ],
        source: [
          `import { prompt } from '@use-crux/core'`,
          `import { thread } from '@use-crux/core/thread'`,
          `export const conversation = thread({ id: 'conversation' })`,
          `export const answer = prompt({`,
          `  id: 'answer',`,
          `  use: [conversation],`,
          `  prompt: 'Answer the user',`,
          `})`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "thread")).toBe(1);
      expect(
        result.nativeOut.definitions.find(
          (definition) => definition.id === "thread:conversation",
        ),
      ).toMatchObject({
        kind: "thread",
        metadata: {
          exportName: "conversation",
          runtimeJoin: {
            primitive: "thread.operation",
            threadId: "conversation",
          },
        },
      });
      expect(result.nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "prompt.uses_thread",
            from: "prompt:answer",
            to: "thread:conversation",
          }),
        ]),
      );
      expectThreadProjectionParity(result);
    },
  );

  itWithRustOxc(
    "keeps array, when, and match bindings across rich prompt configs",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["thread", "prompt"],
        callInterests: [
          {
            name: "thread",
            importFrom: ["@use-crux/core/thread"],
          },
          {
            name: "prompt",
            importFrom: ["@use-crux/core"],
          },
        ],
        source: [
          `import { prompt } from '@use-crux/core'`,
          `import { thread } from '@use-crux/core/thread'`,
          `const arrayThread = thread({ id: 'array-thread' })`,
          `const whenThread = thread({ id: 'when-thread' })`,
          `const matchThread = thread({ id: 'match-thread' })`,
          `const arrayUses = [arrayThread]`,
          `const schema = { parse: (value: unknown) => value }`,
          `const lookup = () => 'found'`,
          `const constraint = { id: 'constraint' }`,
          `const guardrail = { id: 'guardrail' }`,
          `export const arrayPrompt = prompt({`,
          `  id: 'array-prompt',`,
          `  input: schema,`,
          `  output: schema,`,
          `  use: arrayUses,`,
          `  tools: { lookup },`,
          `  constraints: [constraint],`,
          `  guardrails: [guardrail],`,
          `  system: 'Stay concise',`,
          `  prompt: () => 'Answer',`,
          `})`,
          `export const whenPrompt = prompt({`,
          `  id: 'when-prompt',`,
          `  use: [when(true, whenThread)],`,
          `})`,
          `export const matchPrompt = prompt({`,
          `  id: 'match-prompt',`,
          `  use: [match({ cases: { active: [matchThread] }, default: [] })],`,
          `})`,
        ].join("\n"),
      });

      expectThreadProjectionParity(result);
      expect(
        threadProjection(result.typescriptOut)
          .relations.map((relation) => relation.from)
          .sort(),
      ).toEqual([
        "prompt:array-prompt",
        "prompt:match-prompt",
        "prompt:when-prompt",
      ]);
    },
  );

  itWithRustOxc(
    "binds an imported exported Thread from the Prompt source",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["thread", "prompt"],
        callInterests: [
          {
            name: "thread",
            importFrom: ["@use-crux/core/thread"],
          },
          {
            name: "prompt",
            importFrom: ["@use-crux/core"],
          },
        ],
        additionalFiles: [
          {
            path: "src/thread.ts",
            source: [
              `import { thread } from '@use-crux/core/thread'`,
              `export const conversation = thread({ id: 'conversation' })`,
            ].join("\n"),
          },
        ],
        source: [
          `import { prompt } from '@use-crux/core'`,
          `import { conversation } from './thread'`,
          `export const answer = prompt({`,
          `  id: 'answer',`,
          `  use: [conversation],`,
          `})`,
        ].join("\n"),
      });

      expectThreadProjectionParity(result);
      expect(threadProjection(result.typescriptOut).relations).toEqual([
        expect.objectContaining({
          type: "prompt.uses_thread",
          from: "prompt:answer",
          to: "thread:conversation",
          source: expect.objectContaining({ line: 3 }),
        }),
      ]);
    },
  );

  itWithRustOxc("ignores unimported lookalike calls", async () => {
    const result = await extractNativeAndFallback({
      callNames: ["thread"],
      callInterests: [
        {
          name: "thread",
          importFrom: ["@use-crux/core/thread"],
        },
      ],
      source: [
        `const thread = (input: unknown) => input`,
        `export const conversation = thread({ id: 'conversation' })`,
      ].join("\n"),
    });

    expect(nativeFactCount(result.record, "thread")).toBe(0);
    expect(
      result.nativeOut.definitions.filter(
        (definition) => definition.kind === "thread",
      ),
    ).toEqual([]);
    expectThreadProjectionParity(result);
  });
});

function expectThreadProjectionParity(result: {
  readonly nativeOut: StaticFileExtraction;
  readonly fallbackOut: StaticFileExtraction;
  readonly typescriptOut: StaticFileExtraction;
}): void {
  const native = threadProjection(result.nativeOut);
  expect(jsonStable(threadProjection(result.fallbackOut))).toEqual(
    jsonStable(native),
  );
  expect(jsonStable(threadProjection(result.typescriptOut))).toEqual(
    jsonStable(native),
  );
}

function threadProjection(output: StaticFileExtraction) {
  return {
    definitions: output.definitions.filter(
      (definition) => definition.kind === "thread",
    ),
    relations: output.relations
      .filter((relation) => relation.type === "prompt.uses_thread")
      .map((relation) => relation),
  };
}
