import { expect, it } from "vitest";
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from "../src/indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";

const file = "/repo/src/scoped-initializers.ts";
const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();
const parityTest = rustOxcStatus.available ? it : it.skip;

parityTest(
  rustOxcStatus.available
    ? "keeps an earlier same-list declarator and excludes the current declaration"
    : `keeps an earlier same-list declarator and excludes the current declaration [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const { oxc, typescript } = await parseRecords([
      "import { prompt } from '@use-crux/core'",
      "const { lower, Upper } = { lower: 'lower', Upper: 'upper' }, before = { id: 'before' }, writer = prompt({ id: 'writer', system: before }), after = { id: 'after' }",
    ]);

    expect(oxc.matches).toEqual(typescript.matches);
    expect(localInitializerNames(callMatch(typescript, "writer"))).toEqual([
      "Upper",
      "lower",
      "before",
    ]);
  },
);

parityTest(
  rustOxcStatus.available
    ? "prefers the nearest scope and latest same-name initializer"
    : `prefers the nearest scope and latest same-name initializer [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const { oxc, typescript } = await parseRecords([
      "import { prompt } from '@use-crux/core'",
      "const shared = { id: 'outer' }",
      "const outerOnly = { id: 'outer-only' }",
      "{",
      "  const shared = { id: 'inner' }",
      "  var latest = { id: 'first' }",
      "  var latest = { id: 'second' }",
      "  const writer = { id: 'writer', system: shared, prompt: latest }",
      "}",
    ]);

    expect(oxc.matches).toEqual(typescript.matches);
    const localInitializers =
      namedMatch(typescript, "writer").localInitializers ?? [];
    expect(localInitializers.map((initializer) => initializer.name)).toEqual([
      "outerOnly",
      "shared",
      "latest",
    ]);
    expect(
      localInitializers.find((initializer) => initializer.name === "latest")
        ?.snippet?.source,
    ).toBe("{ id: 'second' }");
  },
);

parityTest(
  rustOxcStatus.available
    ? "excludes function declarations from match-local initializer evidence"
    : `excludes function declarations from match-local initializer evidence [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const { oxc, typescript } = await parseRecords([
      "import { prompt } from '@use-crux/core'",
      "function helper() { return 'ready' }",
      "const before = { id: 'before' }",
      "const writer = prompt({ id: 'writer', system: before })",
    ]);

    expect(oxc.matches).toEqual(typescript.matches);
    for (const record of [oxc, typescript]) {
      expect(
        record.localInitializers.map((initializer) => initializer.name),
      ).toContain("helper");
    }
    expect(localInitializerNames(callMatch(typescript, "writer"))).toEqual([
      "before",
    ]);
  },
);

parityTest(
  rustOxcStatus.available
    ? "exposes an enclosing initializer after its value starts"
    : `exposes an enclosing initializer after its value starts [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const { oxc, typescript } = await parseRecords([
      "import { prompt } from '@use-crux/core'",
      "if (true) var wrapper = {",
      "  writer: prompt({ id: 'writer' }),",
      "}",
    ]);

    expect(oxc.matches).toEqual(typescript.matches);
    expect(
      localInitializerNames(callMatchOwnedBy(typescript, "wrapper")),
    ).toEqual(["wrapper"]);
  },
);

parityTest(
  rustOxcStatus.available
    ? "does not index initializer evidence inside class static blocks"
    : `does not index initializer evidence inside class static blocks [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const { oxc, typescript } = await parseRecords([
      "import { prompt } from '@use-crux/core'",
      "class Example {",
      "  static {",
      "    const prior = { id: 'prior' }",
      "    const writer = prompt({ id: 'writer' })",
      "  }",
      "}",
    ]);

    expect(oxc.matches).toEqual(typescript.matches);
    expect(localInitializerNames(callMatch(typescript, "writer"))).toEqual([]);
  },
);

parityTest(
  rustOxcStatus.available
    ? "indexes function scopes passed to direct export-default calls"
    : `indexes function scopes passed to direct export-default calls [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const { oxc, typescript } = await parseRecords([
      "import { prompt } from '@use-crux/core'",
      "export default wrap(() => {",
      "  const prior = { id: 'prior' }",
      "  const writer = new Agent({ id: 'writer' })",
      "})",
    ]);

    expect(oxc.matches).toEqual(typescript.matches);
    expect(localInitializerNames(namedMatch(typescript, "writer"))).toEqual([
      "prior",
    ]);
  },
);

async function parseRecords(lines: readonly string[]) {
  const input = { root: "/repo", file, source: lines.join("\n") };
  const options = { callNames: ["prompt"] };
  const [typescript, oxc] = await Promise.all([
    createTypeScriptStaticSyntaxFrontend(options).parseFile(input),
    createRustOxcStaticSyntaxFrontend(options).parseFile(input),
  ]);
  return { oxc, typescript };
}

function callMatch(record: StaticSyntaxFileRecord, variableName: string) {
  const match = namedMatch(record, variableName);
  if (!match || match.kind !== "call")
    throw new Error(`Missing ${variableName} call match`);
  return match;
}

function namedMatch(record: StaticSyntaxFileRecord, variableName: string) {
  const match = record.matches.find(
    (candidate) => candidate.variableName === variableName,
  );
  if (!match) throw new Error(`Missing ${variableName} match`);
  return match;
}

function callMatchOwnedBy(
  record: StaticSyntaxFileRecord,
  ownerVariableName: string,
) {
  const match = record.matches.find(
    (candidate) =>
      candidate.kind === "call" &&
      candidate.ownerVariableName === ownerVariableName,
  );
  if (!match)
    throw new Error(`Missing call match owned by ${ownerVariableName}`);
  return match;
}

function localInitializerNames(
  match: StaticSyntaxFileRecord["matches"][number],
): readonly string[] {
  return (match.localInitializers ?? []).map((initializer) => initializer.name);
}
