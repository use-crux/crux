import { describe, expect } from "vitest";
import {
  expectNativeExtractionParity,
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

describe("thread native static projection", () => {
  itWithRustOxc(
    "projects exported definitions and prompt bindings with runtime join metadata",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["thread", "prompt"],
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
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc("ignores unimported lookalike calls", async () => {
    const result = await extractNativeAndFallback({
      callNames: ["thread"],
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
    expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
  });
});
