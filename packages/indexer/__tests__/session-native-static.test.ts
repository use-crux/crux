import { describe, expect } from "vitest";
import type { StaticFileExtraction } from "../src/indexer/static/extraction/engine";
import {
  extractNativeAndFallback,
  itWithRustOxc,
  jsonStable,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

describe("Session native static projection", () => {
  itWithRustOxc(
    "projects a literal-key construction and its local Agent target",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["agent", "session"],
        callInterests: [
          {
            name: "agent",
            importFrom: ["@use-crux/core/agent"],
          },
          {
            name: "session",
            importFrom: ["@use-crux/core", "@use-crux/core/session"],
            configArg: 1,
          },
        ],
        source: [
          `import { session } from '@use-crux/core/session'`,
          `import { agent } from '@use-crux/core/agent'`,
          `export const support = agent({ id: 'support' })`,
          `export const supportChat = session(support, { key: 'customer-42' })`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "session")).toBe(1);
      expect(sessionProjection(result.nativeOut)).toMatchObject({
        definitions: [
          {
            id: "session:support:customer-42",
            kind: "session",
            name: "support:customer-42",
            metadata: {
              facts: {
                kind: "session",
                operation: "create",
                targetVariable: "support",
                targetDefinitionId: "agent:support",
                key: { kind: "literal", value: "customer-42" },
                identity: "static",
              },
            },
          },
        ],
        relations: [
          expect.objectContaining({
            type: "session.targets_agent",
            from: "session:support:customer-42",
            to: "agent:support",
          }),
        ],
        sourceRefs: [
          expect.objectContaining({
            definitionId: "session:support:customer-42",
            ref: expect.objectContaining({
              role: "config",
              property: "target",
            }),
          }),
        ],
      });
      expectSessionProjectionParity(result);
    },
  );

  itWithRustOxc("rejects an unrelated same-name local call", async () => {
    const result = await extractNativeAndFallback({
      callNames: ["session"],
      callInterests: [
        {
          name: "session",
          importFrom: ["@use-crux/core", "@use-crux/core/session"],
          configArg: 1,
        },
      ],
      source: [
        `const session = (target: unknown, options: unknown) => ({ target, options })`,
        `export const unrelated = session({}, { key: 'customer-42' })`,
      ].join("\n"),
    });

    expect(nativeFactCount(result.record, "session")).toBe(0);
    expect(sessionProjection(result.nativeOut)).toEqual({
      definitions: [],
      relations: [],
      sourceRefs: [],
    });
    expectSessionProjectionParity(result);
  });

  itWithRustOxc(
    "falls back completely for keyed retrieval through an imported Agent binding",
    async () => {
      const result = await extractNativeAndFallback({
        primaryPath: "src/session.ts",
        additionalFiles: [
          {
            path: "src/agents.ts",
            source: [
              `import { agent } from '@use-crux/core/agent'`,
              `export const support = agent({ id: 'support' })`,
            ].join("\n"),
          },
        ],
        callNames: ["agent", "getSession"],
        callInterests: [
          {
            name: "agent",
            importFrom: ["@use-crux/core/agent"],
          },
          {
            name: "getSession",
            importFrom: ["@use-crux/core", "@use-crux/core/session"],
          },
        ],
        source: [
          `import { getSession } from '@use-crux/core/session'`,
          `import { support } from './agents'`,
          `export const restored = getSession(support, 'customer-42')`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "session")).toBe(0);
      expect(sessionProjection(result.nativeOut)).toMatchObject({
        definitions: [
          {
            id: "session:support:customer-42",
            metadata: {
              facts: {
                operation: "get",
                targetVariable: "support",
                targetDefinitionId: "agent:support",
                key: { kind: "literal", value: "customer-42" },
                identity: "static",
              },
            },
          },
        ],
        relations: [
          expect.objectContaining({
            type: "session.targets_agent",
            from: "session:support:customer-42",
            to: "agent:support",
          }),
        ],
      });
      expectSessionProjectionParity(result);
    },
  );

  itWithRustOxc(
    "classifies dynamic targets and ambiguous construction for diagnostics",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["agent", "session"],
        callInterests: [
          { name: "agent", importFrom: ["@use-crux/core/agent"] },
          {
            name: "session",
            importFrom: ["@use-crux/core", "@use-crux/core/session"],
            configArg: 1,
          },
        ],
        source: [
          `import { agent } from '@use-crux/core/agent'`,
          `import { session } from '@use-crux/core/session'`,
          `const supportAgent = agent({ id: 'support' })`,
          `declare const customerKey: string`,
          `declare function selectAgent(): typeof supportAgent`,
          `declare function sessionOptions(): { key: string }`,
          `export const selected = session(selectAgent(), { key: customerKey })`,
          `export const indirect = session(supportAgent, sessionOptions())`,
        ].join("\n"),
      });

      expectSessionProjectionParity(result);
      const definitions = sessionProjection(result.nativeOut).definitions;
      expect(definitions).toHaveLength(2);
      expect(
        definitions.map((definition) => definition.metadata?.facts),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: { kind: "dynamic" },
            call: { kind: "supported" },
          }),
          expect.objectContaining({
            target: { kind: "agent" },
            call: { kind: "ambiguous", reason: "options" },
          }),
        ]),
      );
    },
  );
});

function expectSessionProjectionParity(result: {
  readonly nativeOut: StaticFileExtraction;
  readonly fallbackOut: StaticFileExtraction;
  readonly typescriptOut: StaticFileExtraction;
}): void {
  const native = sessionProjection(result.nativeOut);
  expect(jsonStable(sessionProjection(result.fallbackOut))).toEqual(
    jsonStable(native),
  );
  expect(jsonStable(sessionProjection(result.typescriptOut))).toEqual(
    jsonStable(native),
  );
}

function sessionProjection(output: StaticFileExtraction) {
  const definitions = output.definitions.filter(
    (definition) => definition.kind === "session",
  );
  return {
    definitions,
    relations: output.relations.filter(
      (relation) => relation.type === "session.targets_agent",
    ),
    sourceRefs: definitions.flatMap((definition) =>
      (definition.sourceRefs ?? []).map((ref) => ({
        definitionId: definition.id,
        ref,
      })),
    ),
  };
}
