import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  createStaticExtraction,
  type SourceReader,
} from "../src/indexer/static/extraction/engine";
import type { StaticFileExtraction } from "../src/indexer/static/extraction/engine";
import {
  createProvidedStaticSyntaxFrontend,
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxCallInterest,
} from "../src/indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";

const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();

/** Runs a Vitest case only when the Rust/Oxc syntax frontend is available. */
export function itWithRustOxc(
  name: string,
  fn: () => Promise<void>,
  timeout?: number,
): void {
  const testName = rustOxcStatus.available
    ? name
    : `${name} [skipped: ${rustOxcStatus.reason ?? "Rust/Oxc unavailable"}]`;
  if (rustOxcStatus.available) {
    it(testName, fn, timeout);
    return;
  }
  it.skip(testName, fn, timeout);
}

interface NativeFirstPartyFixtureInput {
  /** Source text for the single TypeScript fixture file. */
  readonly source: string;
  /** Root-relative primary fixture path. */
  readonly primaryPath?: string;
  /** Additional project files available to import/source-ref resolution. */
  readonly additionalFiles?: readonly {
    /** Root-relative path for the support file. */
    readonly path: string;
    /** Source text for the support file. */
    readonly source: string;
  }[];
  /** Factory call names the Rust/Oxc frontend should retain for static extraction. */
  readonly callNames: readonly string[];
  /** Import-aware factory interests used to reject same-name local calls. */
  readonly callInterests?: readonly StaticSyntaxCallInterest[];
  /** Constructor names the Rust/Oxc frontend should retain for static extraction. */
  readonly constructorNames?: readonly string[];
}

/** Extracts one fixture through native packets and the TypeScript fallback baseline. */
export async function extractNativeAndFallback(
  input: NativeFirstPartyFixtureInput,
) {
  const root = await mkdtemp(join(tmpdir(), "crux-native-fixture-"));
  const file = join(root, input.primaryPath ?? "src/fixture.ts");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, input.source);
  const fileSources: Record<string, string> = { [file]: input.source };
  for (const supportFile of input.additionalFiles ?? []) {
    const supportPath = join(root, supportFile.path);
    await mkdir(dirname(supportPath), { recursive: true });
    await writeFile(supportPath, supportFile.source);
    fileSources[supportPath] = supportFile.source;
  }
  try {
    const frontend = createRustOxcStaticSyntaxFrontend({
      callNames: [...input.callNames],
      ...(input.callInterests
        ? { callInterests: [...input.callInterests] }
        : {}),
      ...(input.constructorNames
        ? { constructorNames: [...input.constructorNames] }
        : {}),
    });
    const records = await Promise.all(
      Object.entries(fileSources).map(([sourceFile, source]) =>
        frontend.parseFile({
          root,
          file: sourceFile,
          source,
        }),
      ),
    );
    const record = records.find((item) => item.file === file);
    if (!record) throw new Error(`Missing primary fixture record: ${file}`);
    const sources = memorySourceReader(fileSources);
    const nativeExtraction = createStaticExtraction({
      root,
      cache: "none",
      sources,
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records }),
    });
    const fallbackExtraction = createStaticExtraction({
      root,
      cache: "none",
      sources,
      syntaxFrontend: createProvidedStaticSyntaxFrontend({
        records: records.map((item) => ({ ...item, nativeFacts: [] })),
      }),
    });
    const typescriptExtraction = createStaticExtraction({
      root,
      cache: "none",
      sources,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    });
    const [nativeOut, fallbackOut, typescriptOut] = await Promise.all([
      nativeExtraction.extractFile(file),
      fallbackExtraction.extractFile(file),
      typescriptExtraction.extractFile(file),
    ]);
    return { fallbackOut, nativeOut, record, typescriptOut };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** JSON-clones values so equality checks ignore object prototypes and readonly wrappers. */
export function jsonStable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Asserts exact native/fallback parity for every static extraction surface.
 *
 * This intentionally compares the whole `StaticFileExtraction` object instead
 * of cherry-picking definitions or relations. Phase 4 coverage depends on
 * dependencies, semantic handoff rows, cache markers, and diagnostics staying
 * covered when new fixture families are marked native-ready.
 */
export function expectNativeExtractionParity(
  nativeOut: StaticFileExtraction,
  fallbackOut: StaticFileExtraction,
): void {
  expect(Object.keys(nativeOut).sort()).toEqual(
    Object.keys(fallbackOut).sort(),
  );
  expect(jsonStable(nativeOut)).toEqual(jsonStable(fallbackOut));
}

/** Counts native fact packets that replace one bundled first-party extractor. */
export function nativeFactCount(
  record: {
    readonly nativeFacts?: readonly {
      readonly replaces?: readonly { readonly extractor: string }[];
    }[];
  },
  extractor: string,
): number {
  return (record.nativeFacts ?? []).filter((fact) =>
    fact.replaces?.some((item) => item.extractor === extractor),
  ).length;
}

function memorySourceReader(
  files: Readonly<Record<string, string>>,
): SourceReader {
  return {
    read: async (file) => {
      const source = files[file];
      if (source === undefined)
        throw new Error(`Missing fixture source: ${file}`);
      return source;
    },
  };
}
