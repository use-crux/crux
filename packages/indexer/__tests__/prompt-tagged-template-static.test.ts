import { expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";
import type { StaticSyntaxFileRecord } from "../src/indexer/static-index/syntax";
import { createStaticRecordSourceResolver } from "../src/indexer/static-index/compatibility/syntax-record-bridge/source-resolver";

itWithRustOxc(
  "keeps inline system and prompt tags as syntax without owner refs",
  async () => {
    const source = [
      "import { md as text, prompt } from '@use-crux/core'",
      'export const writer = prompt({ id: "writer", system: text`System`, prompt: text`Prompt` })',
    ].join("\n");
    const { nativeOut, record } = await extractNativeAndFallback({
      source,
      callNames: ["prompt"],
    });
    const systemValue = propertyValue(record, "writer", "system");
    const promptValue = propertyValue(record, "writer", "prompt");
    const resolver = createStaticRecordSourceResolver({
      record,
      initializers: new Map(
        record.localInitializers.map((initializer) => [
          initializer.name,
          initializer.value,
        ]),
      ),
      initializerRecords: record.localInitializers,
    });

    expect(systemValue).toEqual(
      inlineTag("`System`", "text`System`", 2, 54, 66),
    );
    expect(promptValue).toEqual(
      inlineTag("`Prompt`", "text`Prompt`", 2, 76, 88),
    );
    expect(resolver.resolveValue(systemValue)).toBeUndefined();
    expect(resolver.resolveValue(promptValue)).toBeUndefined();

    const writer = nativeOut.definitions.find(
      (definition) => definition.id === "prompt:writer",
    );
    expect(writer).toBeDefined();
    expect(writer?.sourceRefs).toBeUndefined();
  },
  30_000,
);

itWithRustOxc(
  "keeps direct prompt and system tagged-template owner refs in native facts",
  async () => {
    const source = [
      "import { md as text, prompt } from '@use-crux/core'",
      "const authored = text`Answer ${question}`",
      "export const writer = prompt({ id: 'writer', system: authored, prompt: authored })",
    ].join("\n");
    const { nativeOut } = await extractNativeAndFallback({
      source,
      callNames: ["prompt"],
    });

    const writer = nativeOut.definitions.find(
      (definition) => definition.id === "prompt:writer",
    );
    expect(writer?.sourceRefs).toEqual([
      ownerRef("prompt"),
      ownerRef("system", { fragment: true }),
    ]);
    expect(JSON.stringify(writer)).not.toContain("promptText");
  },
  30_000,
);

itWithRustOxc(
  "uses the exact tag source for a parenthesized named native owner ref",
  async () => {
    const source = [
      "import { md as text, prompt } from '@use-crux/core'",
      "const authored = (text`Answer ${question}`)",
      "export const writer = prompt({ id: 'writer', prompt: authored })",
    ].join("\n");
    const { nativeOut } = await extractNativeAndFallback({
      source,
      callNames: ["prompt"],
    });

    const writer = nativeOut.definitions.find(
      (definition) => definition.id === "prompt:writer",
    );
    expect(writer?.sourceRefs).toEqual([ownerRef("prompt", undefined, 19, 43)]);
  },
  30_000,
);

itWithRustOxc(
  "keeps property-access tagged-template owner refs exact in native facts",
  async () => {
    const source = [
      "import { md as text, prompt } from '@use-crux/core'",
      "const fragments = { answer: text`Answer ${question}` }",
      "export const writer = prompt({ id: 'writer', prompt: fragments.answer })",
    ].join("\n");
    const { nativeOut } = await extractNativeAndFallback({
      source,
      callNames: ["prompt"],
    });

    const expected = [
      {
        id: "prompt:writer:source:prompt:prompt:fragments.answer",
        role: "prompt",
        property: "prompt",
        symbol: "fragments.answer",
        source: {
          file: expect.any(String),
          line: 2,
          column: 29,
        },
        snippet: {
          source: "text`Answer ${question}`",
          language: "typescript",
          range: {
            file: expect.any(String),
            startLine: 2,
            startColumn: 29,
            endLine: 2,
            endColumn: 53,
          },
          truncated: false,
        },
        fidelity: "resolved",
      },
    ];

    expect(
      nativeOut.definitions.find(
        (definition) => definition.id === "prompt:writer",
      )?.sourceRefs,
    ).toEqual(expected);
  },
  30_000,
);

function ownerRef(
  role: "prompt" | "system",
  metadata?: { readonly fragment: true },
  startColumn = 18,
  endColumn = 42,
) {
  return {
    id: `prompt:writer:source:${role}:${role}:authored`,
    role,
    property: role,
    symbol: "authored",
    source: {
      file: expect.any(String),
      line: 2,
      column: startColumn,
    },
    snippet: {
      source: "text`Answer ${question}`",
      language: "typescript",
      range: {
        file: expect.any(String),
        startLine: 2,
        startColumn,
        endLine: 2,
        endColumn,
      },
      truncated: false,
    },
    fidelity: "resolved",
    ...(metadata ? { metadata } : {}),
  };
}

function propertyValue(
  record: StaticSyntaxFileRecord,
  variableName: string,
  propertyName: string,
) {
  const match = record.matches.find(
    (candidate) => candidate.variableName === variableName,
  );
  if (!match || match.kind !== "call")
    throw new Error(`Missing ${variableName} call match`);
  const property = match.objectArg?.properties.find(
    (candidate) => candidate.name === propertyName,
  );
  if (!property)
    throw new Error(`Missing ${variableName}.${propertyName} property`);
  return property.value;
}

function inlineTag(
  text: string,
  source: string,
  line: number,
  startColumn: number,
  endColumn: number,
) {
  return {
    kind: "tagged-template",
    tag: {
      name: "md",
      direct: true,
      localName: "text",
      importedName: "md",
      moduleSpecifier: "@use-crux/core",
    },
    text,
    expressions: [],
    source: {
      file: expect.any(String),
      line,
      column: startColumn,
    },
    snippet: {
      source,
      language: "typescript",
      range: {
        file: expect.any(String),
        startLine: line,
        startColumn,
        endLine: line,
        endColumn,
      },
      truncated: false,
    },
  };
}
