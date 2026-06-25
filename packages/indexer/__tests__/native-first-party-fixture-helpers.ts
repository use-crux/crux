import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it } from 'vitest'
import { createStaticExtraction, type SourceReader } from '../indexer/static/extraction/engine'
import { createProvidedStaticSyntaxFrontend } from '../indexer/static-index/syntax'
import { createRustOxcStaticSyntaxFrontend, rustOxcSyntaxFrontendTestStatus } from '../testing/rust-oxc-frontend'

const rustOxcStatus = rustOxcSyntaxFrontendTestStatus()

/** Runs a Vitest case only when the Rust/Oxc syntax frontend is available. */
export function itWithRustOxc(name: string, fn: () => Promise<void>, timeout?: number): void {
  const testName = rustOxcStatus.available ? name : `${name} [skipped: ${rustOxcStatus.reason ?? 'Rust/Oxc unavailable'}]`
  if (rustOxcStatus.available) {
    it(testName, fn, timeout)
    return
  }
  it.skip(testName, fn, timeout)
}

interface NativeFirstPartyFixtureInput {
  /** Source text for the single TypeScript fixture file. */
  readonly source: string
  /** Additional project files available to import/source-ref resolution. */
  readonly additionalFiles?: readonly {
    /** Root-relative path for the support file. */
    readonly path: string
    /** Source text for the support file. */
    readonly source: string
  }[]
  /** Factory call names the Rust/Oxc frontend should retain for static extraction. */
  readonly callNames: readonly string[]
  /** Constructor names the Rust/Oxc frontend should retain for static extraction. */
  readonly constructorNames?: readonly string[]
}

/** Extracts one fixture through native packets and the TypeScript fallback baseline. */
export async function extractNativeAndFallback(input: NativeFirstPartyFixtureInput) {
  const root = await mkdtemp(join(tmpdir(), 'crux-native-fixture-'))
  const file = join(root, 'src/fixture.ts')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, input.source)
  const fileSources: Record<string, string> = { [file]: input.source }
  for (const supportFile of input.additionalFiles ?? []) {
    const supportPath = join(root, supportFile.path)
    await mkdir(dirname(supportPath), { recursive: true })
    await writeFile(supportPath, supportFile.source)
    fileSources[supportPath] = supportFile.source
  }
  try {
    const frontend = createRustOxcStaticSyntaxFrontend({
      callNames: [...input.callNames],
      ...(input.constructorNames ? { constructorNames: [...input.constructorNames] } : {}),
    })
    const records = await Promise.all(
      Object.entries(fileSources).map(([sourceFile, source]) =>
        frontend.parseFile({
          root,
          file: sourceFile,
          source,
        }),
      ),
    )
    const record = records.find((item) => item.file === file)
    if (!record) throw new Error(`Missing primary fixture record: ${file}`)
    const sources = memorySourceReader(fileSources)
    const nativeExtraction = createStaticExtraction({
      root,
      cache: 'none',
      sources,
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records }),
    })
    const fallbackExtraction = createStaticExtraction({
      root,
      cache: 'none',
      sources,
      syntaxFrontend: createProvidedStaticSyntaxFrontend({
        records: records.map((item) => ({ ...item, nativeFacts: [] })),
      }),
    })
    const [nativeOut, fallbackOut] = await Promise.all([
      nativeExtraction.extractFile(file),
      fallbackExtraction.extractFile(file),
    ])
    return { fallbackOut, nativeOut, record }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** JSON-clones values so equality checks ignore object prototypes and readonly wrappers. */
export function jsonStable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Counts native fact packets that replace one bundled first-party extractor. */
export function nativeFactCount(
  record: { readonly nativeFacts?: readonly { readonly replaces?: readonly { readonly extractor: string }[] }[] },
  extractor: string,
): number {
  return (record.nativeFacts ?? []).filter((fact) => fact.replaces?.some((item) => item.extractor === extractor)).length
}

function memorySourceReader(files: Readonly<Record<string, string>>): SourceReader {
  return {
    read: async (file) => {
      const source = files[file]
      if (source === undefined) throw new Error(`Missing fixture source: ${file}`)
      return source
    },
  }
}
