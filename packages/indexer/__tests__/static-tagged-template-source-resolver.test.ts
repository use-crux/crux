import { describe, expect, it } from "vitest";
import { createStaticRecordSourceResolver } from "../src/indexer/static-index/compatibility/syntax-record-bridge/source-resolver";
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from "../src/indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";

const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();

describe("tagged-template record source resolution", () => {
  it("uses a named tagged initializer own source and snippet", async () => {
    const file = "/repo/src/prompt.ts";
    const record = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["prompt"],
    }).parseFile({
      root: "/repo",
      file,
      source: [
        "import { md as text, prompt } from '@use-crux/core'",
        "const authored = text`Answer ${question}`",
        "export const writer = prompt({ id: 'writer', prompt: authored })",
      ].join("\n"),
    });
    const promptValue = propertyValue(callMatch(record, "writer"), "prompt");
    const initializers = new Map(
      record.localInitializers.map((initializer) => [
        initializer.name,
        initializer.value,
      ]),
    );
    const resolver = createStaticRecordSourceResolver({
      record,
      initializers,
      initializerRecords: record.localInitializers,
    });

    expect(resolver.resolveValue(promptValue)).toMatchObject({
      symbol: "authored",
      value: { kind: "tagged-template" },
      source: { file, line: 2, column: 18 },
      snippet: {
        source: "text`Answer ${question}`",
        language: "typescript",
        range: {
          file,
          startLine: 2,
          startColumn: 18,
          endLine: 2,
          endColumn: 42,
        },
        truncated: false,
      },
    });
  });

  const parenthesizedParityTest = rustOxcStatus.available ? it : it.skip;
  parenthesizedParityTest(
    rustOxcStatus.available
      ? "uses the exact tag source for a parenthesized named initializer"
      : `uses the exact tag source for a parenthesized named initializer [skipped: ${rustOxcStatus.reason}]`,
    async () => {
      const file = "/repo/src/prompt.ts";
      const source = [
        "import { md as text, prompt } from '@use-crux/core'",
        "const authored = (text`Answer ${question}`)",
        "export const writer = prompt({ id: 'writer', prompt: authored })",
      ].join("\n");
      const input = { root: "/repo", file, source };
      const [typescript, oxc] = await Promise.all([
        createTypeScriptStaticSyntaxFrontend({
          callNames: ["prompt"],
        }).parseFile(input),
        createRustOxcStaticSyntaxFrontend({
          callNames: ["prompt"],
        }).parseFile(input),
      ]);

      expect(resolvedPromptSourceEvidence(oxc, "writer")).toEqual(
        resolvedPromptSourceEvidence(typescript, "writer"),
      );
      expect(resolvedPromptSourceEvidence(typescript, "writer")).toMatchObject({
        symbol: "authored",
        value: { kind: "tagged-template" },
        source: { file, line: 2, column: 19 },
        snippet: {
          source: "text`Answer ${question}`",
          language: "typescript",
          range: {
            file,
            startLine: 2,
            startColumn: 19,
            endLine: 2,
            endColumn: 43,
          },
          truncated: false,
        },
      });
    },
  );

  const parityTest = rustOxcStatus.available ? it : it.skip;
  parityTest(
    rustOxcStatus.available
      ? "uses the same exact property-access tagged source for Oxc and TypeScript records"
      : `uses the same exact property-access tagged source for Oxc and TypeScript records [skipped: ${rustOxcStatus.reason}]`,
    async () => {
      const file = "/repo/src/prompt.ts";
      const source = [
        "import { md as text, prompt } from '@use-crux/core'",
        "const fragments = { answer: text`Answer ${question}` }",
        "export const writer = prompt({ id: 'writer', prompt: fragments.answer })",
      ].join("\n");
      const input = { root: "/repo", file, source };
      const [typescript, oxc] = await Promise.all([
        createTypeScriptStaticSyntaxFrontend({
          callNames: ["prompt"],
        }).parseFile(input),
        createRustOxcStaticSyntaxFrontend({
          callNames: ["prompt"],
        }).parseFile(input),
      ]);

      expect(resolvedPromptSourceEvidence(oxc, "writer")).toEqual(
        resolvedPromptSourceEvidence(typescript, "writer"),
      );
      expect(resolvedPromptSourceEvidence(typescript, "writer")).toMatchObject({
        symbol: "fragments.answer",
        value: { kind: "tagged-template" },
        source: { file, line: 2, column: 29 },
        snippet: {
          source: "text`Answer ${question}`",
          language: "typescript",
          range: {
            file,
            startLine: 2,
            startColumn: 29,
            endLine: 2,
            endColumn: 53,
          },
          truncated: false,
        },
      });
    },
  );
});

function resolvedPromptSource(
  record: StaticSyntaxFileRecord,
  variableName: string,
) {
  const promptValue = propertyValue(callMatch(record, variableName), "prompt");
  const initializers = new Map(
    record.localInitializers.map((initializer) => [
      initializer.name,
      initializer.value,
    ]),
  );
  return createStaticRecordSourceResolver({
    record,
    initializers,
    initializerRecords: record.localInitializers,
  }).resolveValue(promptValue);
}

function resolvedPromptSourceEvidence(
  record: StaticSyntaxFileRecord,
  variableName: string,
) {
  const resolved = resolvedPromptSource(record, variableName);
  return resolved
    ? {
        symbol: resolved.symbol,
        value: resolved.value,
        source: resolved.source,
        snippet: resolved.snippet,
        functionName: resolved.functionName,
      }
    : undefined;
}

function callMatch(record: StaticSyntaxFileRecord, variableName: string) {
  const match = record.matches.find(
    (candidate) => candidate.variableName === variableName,
  );
  if (!match || match.kind !== "call")
    throw new Error(`Missing ${variableName} call match`);
  return match;
}

function propertyValue(
  match: Extract<
    StaticSyntaxFileRecord["matches"][number],
    { readonly kind: "call" }
  >,
  propertyName: string,
) {
  const property = match.objectArg?.properties.find(
    (candidate) => candidate.name === propertyName,
  );
  if (!property) throw new Error(`Missing ${propertyName} property`);
  return property.value;
}
