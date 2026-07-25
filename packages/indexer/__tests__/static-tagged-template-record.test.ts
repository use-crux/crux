import { describe, expect, it } from "vitest";
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from "../src/indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";

const file = "/repo/src/tagged.ts";
const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();
const source = [
  "import { md, md as text } from '@use-crux/core'",
  "import * as crux from '@use-crux/core'",
  "const value = 'Ada'",
  "const direct = md`x${value}`",
  "const alias = text`y${value}`",
  "const namespace = crux.md`z${value}`",
  "const nested = md`o${text`i${value}`}`",
  "const unrelated = html`u${value}`",
].join("\n");
const promptSource = [
  "import { md as text, prompt } from '@use-crux/core'",
  "const value = 'Ada'",
  "const named = text`named ${value}`",
  "export const writer = prompt({",
  "  system: text`inline ${value}`,",
  "  prompt: named,",
  "})",
  "export const dynamic = prompt({",
  "  prompt: () => text`dynamic ${value}`,",
  "})",
].join("\n");

describe("static tagged-template records", () => {
  it("records canonical tag callees, exact template text, and exact ranges", async () => {
    const record = await taggedTemplateRecord();

    expect(initializerValue(record, "direct")).toEqual({
      kind: "tagged-template",
      tag: importedTag("md"),
      text: "`x${value}`",
      expressions: [
        {
          value: { kind: "identifier", name: "value" },
          source: location(4, 22),
        },
      ],
      source: location(4, 16),
      snippet: snippet("md`x${value}`", 4, 16, 29),
    });
    expect(initializerValue(record, "alias")).toEqual({
      kind: "tagged-template",
      tag: importedTag("text"),
      text: "`y${value}`",
      expressions: [
        {
          value: { kind: "identifier", name: "value" },
          source: location(5, 23),
        },
      ],
      source: location(5, 15),
      snippet: snippet("text`y${value}`", 5, 15, 30),
    });
    expect(initializerValue(record, "namespace")).toEqual({
      kind: "tagged-template",
      tag: {
        name: "md",
        direct: false,
        localName: "crux",
        receiverName: "crux",
        importedName: "md",
        moduleSpecifier: "@use-crux/core",
      },
      text: "`z${value}`",
      expressions: [
        {
          value: { kind: "identifier", name: "value" },
          source: location(6, 30),
        },
      ],
      source: location(6, 19),
      snippet: snippet("crux.md`z${value}`", 6, 19, 37),
    });
  });

  it("recurses into nested tags and retains unrelated tags neutrally", async () => {
    const record = await taggedTemplateRecord();

    expect(initializerValue(record, "nested")).toEqual({
      kind: "tagged-template",
      tag: importedTag("md"),
      text: "`o${text`i${value}`}`",
      expressions: [
        {
          value: {
            kind: "tagged-template",
            tag: importedTag("text"),
            text: "`i${value}`",
            expressions: [
              {
                value: { kind: "identifier", name: "value" },
                source: location(7, 30),
              },
            ],
            source: location(7, 22),
            snippet: snippet("text`i${value}`", 7, 22, 37),
          },
          source: location(7, 22),
        },
      ],
      source: location(7, 16),
      snippet: snippet("md`o${text`i${value}`}`", 7, 16, 39),
    });
    expect(initializerValue(record, "unrelated")).toEqual({
      kind: "tagged-template",
      tag: { name: "html", direct: true, localName: "html" },
      text: "`u${value}`",
      expressions: [
        {
          value: { kind: "identifier", name: "value" },
          source: location(8, 27),
        },
      ],
      source: location(8, 19),
      snippet: snippet("html`u${value}`", 8, 19, 34),
    });
    expect(JSON.stringify(record)).not.toContain("promptText");
  });

  it("keeps exact tags in prompt fields, named fragments, and callback returns", async () => {
    const record = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["prompt"],
    }).parseFile({
      root: "/repo",
      file,
      source: promptSource,
    });
    const writer = callMatch(record, "writer");
    const dynamic = callMatch(record, "dynamic");

    expect(initializerValue(record, "named")).toEqual({
      kind: "tagged-template",
      tag: importedTag("text"),
      text: "`named ${value}`",
      expressions: [
        {
          value: { kind: "identifier", name: "value" },
          source: location(3, 28),
        },
      ],
      source: location(3, 15),
      snippet: snippet("text`named ${value}`", 3, 15, 35),
    });
    expect(objectProperty(writer, "system")).toEqual({
      kind: "tagged-template",
      tag: importedTag("text"),
      text: "`inline ${value}`",
      expressions: [
        {
          value: { kind: "identifier", name: "value" },
          source: location(5, 25),
        },
      ],
      source: location(5, 11),
      snippet: snippet("text`inline ${value}`", 5, 11, 32),
    });
    expect(objectProperty(dynamic, "prompt")).toMatchObject({
      kind: "function",
      returns: [
        {
          kind: "tagged-template",
          tag: importedTag("text"),
          text: "`dynamic ${value}`",
          expressions: [
            {
              value: { kind: "identifier", name: "value" },
              source: location(9, 32),
            },
          ],
          source: location(9, 17),
          snippet: snippet("text`dynamic ${value}`", 9, 17, 39),
        },
      ],
    });
  });

  const parityTest = rustOxcStatus.available ? it : it.skip;
  parityTest(
    rustOxcStatus.available
      ? "keeps Oxc and TypeScript tagged-template records equal"
      : `keeps Oxc and TypeScript tagged-template records equal [skipped: ${rustOxcStatus.reason}]`,
    async () => {
      const options = { callNames: ["prompt"] };
      const input = { root: "/repo", file, source };
      const [typescript, oxc] = await Promise.all([
        createTypeScriptStaticSyntaxFrontend(options).parseFile(input),
        createRustOxcStaticSyntaxFrontend(options).parseFile(input),
      ]);

      expect(oxc.localInitializers).toEqual(typescript.localInitializers);
      expect(oxc.matches).toEqual(typescript.matches);

      const promptInput = { root: "/repo", file, source: promptSource };
      const [typescriptPrompt, oxcPrompt] = await Promise.all([
        createTypeScriptStaticSyntaxFrontend(options).parseFile(promptInput),
        createRustOxcStaticSyntaxFrontend(options).parseFile(promptInput),
      ]);
      expect(oxcPrompt.localInitializers).toEqual(
        typescriptPrompt.localInitializers,
      );
      expect(oxcPrompt.matches).toEqual(typescriptPrompt.matches);
    },
  );
});

async function taggedTemplateRecord(): Promise<StaticSyntaxFileRecord> {
  return createTypeScriptStaticSyntaxFrontend().parseFile({
    root: "/repo",
    file,
    source,
  });
}

function initializerValue(record: StaticSyntaxFileRecord, name: string) {
  const initializer = record.localInitializers.find(
    (candidate) => candidate.name === name,
  );
  if (!initializer) throw new Error(`Missing ${name} initializer`);
  return initializer.value;
}

function callMatch(record: StaticSyntaxFileRecord, variableName: string) {
  const match = record.matches.find(
    (candidate) => candidate.variableName === variableName,
  );
  if (!match || match.kind !== "call")
    throw new Error(`Missing ${variableName} call match`);
  return match;
}

function objectProperty(
  match: Extract<
    StaticSyntaxFileRecord["matches"][number],
    { readonly kind: "call" }
  >,
  name: string,
) {
  const property = match.objectArg?.properties.find(
    (candidate) => candidate.name === name,
  );
  if (!property) throw new Error(`Missing ${name} property`);
  return property.value;
}

function importedTag(localName: string) {
  return {
    name: "md",
    direct: true,
    localName,
    importedName: "md",
    moduleSpecifier: "@use-crux/core",
  };
}

function location(line: number, column: number) {
  return { file, line, column };
}

function snippet(
  text: string,
  line: number,
  startColumn: number,
  endColumn: number,
) {
  return {
    source: text,
    language: "typescript",
    range: { file, startLine: line, startColumn, endLine: line, endColumn },
    truncated: false,
  };
}
