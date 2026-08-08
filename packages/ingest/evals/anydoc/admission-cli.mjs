import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { build, stop } from 'esbuild'

const directory = process.env.CRUX_ANYDOC_EVAL_DIRECTORY ?? dirname(fileURLToPath(import.meta.url))
const cacheDirectory = process.env.CRUX_ANYDOC_EVAL_CACHE_DIRECTORY ?? resolve(directory, '../../node_modules/.cache/crux-anydoc-eval')
const worker = resolve(cacheDirectory, 'admission-family-worker.mjs')
const resultDirectory = resolve(cacheDirectory, 'families')
const allFormats = ['csv', 'doc', 'docm', 'docx', 'epub', 'ods', 'odt', 'pdf', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx']
const formats = process.env.CRUX_ANYDOC_FORMATS?.split(',').filter((format) => allFormats.includes(format)) ?? allFormats
const execute = promisify(execFile)
const hardMemoryContainment = false
const cacheIdentity = await evidenceCacheIdentity()
if (process.env.CRUX_ANYDOC_IDENTITY_ONLY === '1') {
  process.stdout.write(JSON.stringify({ cacheIdentity }))
  process.exit(0)
}
const sourceHashes = await currentFixtureHashes()

await mkdir(dirname(worker), { recursive: true })
await mkdir(resultDirectory, { recursive: true })
await build({
  entryPoints: [resolve(directory, 'admission-family-worker.ts')],
  outfile: worker,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  external: ['@firecrawl/anydoc', '@firecrawl/anydoc-*', '@firecrawl/pdf-inspector', '@firecrawl/pdf-inspector-*', 'esbuild', 'pdfjs-dist/*'],
})
stop()

const families = []
for (const format of formats) {
  if (process.env.DEBUG_ANYDOC_EVIDENCE === '1') process.stderr.write(`anydoc-family:${format}\n`)
  const resultPath = resolve(resultDirectory, `${format}.json`)
  let family
  try {
    family = validateFamily(JSON.parse(await readFile(resultPath, 'utf8')), format, cacheIdentity, sourceHashes)
  } catch {
    const arguments_ = [worker, format]
    const { stdout } = await execute(process.execPath, arguments_, {
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CRUX_ANYDOC_EVAL_DIRECTORY: directory },
    })
    family = { ...validateFamily(JSON.parse(stdout), format, undefined, sourceHashes), cacheIdentity }
    const temporary = `${resultPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(family)}\n`)
    await rename(temporary, resultPath)
  }
  families.push(family)
}

const results = families.flatMap((family) => family.results).map((result) => ({
  ...result,
  candidates: result.candidates.map((candidate) => !hardMemoryContainment && candidate.parser === 'anydoc'
    ? containmentUnavailableCandidate(candidate.parser, result.fixtureId)
    : candidate),
}))
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  runner: { maxConcurrentChildren: 1, productionEquivalent: false, hardMemoryContainment },
  results,
  formats: families.flatMap((family) => family.formats).map((decision) =>
    !hardMemoryContainment && decision.parser === 'anydoc'
      ? { ...decision, admitted: false, blockers: [...new Set([...decision.blockers, 'hard-memory-containment'])] }
      : decision),
  docxDecision: { primary: null, reason: 'No candidate passed every format-wide gate.' },
  cacheIdentity,
}))

function validateFamily(value, format, identity, currentSources) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.results) || !Array.isArray(value.formats)
    || (identity !== undefined && value.cacheIdentity !== identity)
    || value.results.some((result) => result.format !== format || typeof result.fixtureId !== 'string' || typeof result.sourceHashMatches !== 'boolean'
      || (currentSources.has(result.fixtureId) && result.sourceHash !== currentSources.get(result.fixtureId)))) {
    throw new Error(`Invalid cached admission family result for ${format}.`)
  }
  return value
}

async function currentFixtureHashes() {
  const sources = new Map([
    ['docx-structure-v1', 'fixtures/prose.docx'], ['doc-legacy-v1', 'fixtures/prose.doc'],
    ['rtf-prose-v1', 'fixtures/prose.rtf'], ['odt-prose-v1', 'fixtures/prose.odt'],
    ['epub-prose-v1', 'fixtures/prose.epub'], ['pptx-structure-v1', 'fixtures/slides.pptx'],
    ['xls-spreadsheet-v1', 'fixtures/sheet.xls'], ['ods-spreadsheet-v1', 'fixtures/sheet.ods'],
    ['csv-control-v1', 'fixtures/csv-control-v1.csv'], ['xlsx-control-v1', 'fixtures/sheet.xlsx'],
    ['pdf-control-v1', '../../__tests__/fixtures/layout-aware-mixed.pdf'], ['truncated-v1', 'fixtures/truncated.docx'],
    ['malformed-v1', 'fixtures/malformed.docx'], ['mislabeled-v1', 'fixtures/mislabeled.docx'],
    ['expansion-heavy-v1', 'fixtures/expansion-heavy.docx'], ['external-link-v1', 'fixtures/external-link.docx'],
  ])
  await Promise.all([...sources].map(async ([id, path]) => {
    sources.set(id, createHash('sha256').update(await readFile(resolve(directory, path))).digest('hex'))
  }))
  return sources
}

async function evidenceCacheIdentity() {
  const files = [
    'admission-family-worker.ts', 'admission-suite.ts', 'anydoc-worker.mjs', 'expected-facts.ts',
    'fixture-manifest.ts', 'incumbent-worker.ts', 'sequential-runner.ts', 'structural-assertions.ts',
    'native-csv-facts.ts', 'native-fact-schema.ts', 'native-mammoth-facts.ts', '../../private/anydoc-admission.mjs',
    'native-pdf-facts.ts', 'native-xlsx-facts.ts', 'containment.ts',
  ]
  const coreProjectors = [
    '../../src/csv.ts', '../../src/docx.ts', '../../src/parsers.ts', '../../src/pdf.ts',
    '../../src/parse-result-schema-2.ts', '../../src/xlsx.ts',
  ]
  const nativeArtifact = process.env.CRUX_ANYDOC_NATIVE_ARTIFACT
    ?? resolve(directory, '../../../../node_modules/.pnpm/@firecrawl+anydoc-linux-x64-gnu@0.1.7/node_modules/@firecrawl/anydoc-linux-x64-gnu/anydoc.linux-x64-gnu.node')
  const packageJson = process.env.CRUX_ANYDOC_PACKAGE_JSON
    ?? resolve(directory, '../../../../node_modules/.pnpm/@firecrawl+anydoc@0.1.7/node_modules/@firecrawl/anydoc/package.json')
  const incumbentPackages = [
    ['mammoth@1.12.0', process.env.CRUX_MAMMOTH_PACKAGE_JSON ?? resolve(directory, '../../../../node_modules/.pnpm/mammoth@1.12.0/node_modules/mammoth/package.json')],
    ['csv-parse@6.2.1', process.env.CRUX_CSV_PARSE_PACKAGE_JSON ?? resolve(directory, '../../../../node_modules/.pnpm/csv-parse@6.2.1/node_modules/csv-parse/package.json')],
    ['exceljs@4.4.0', process.env.CRUX_EXCELJS_PACKAGE_JSON ?? resolve(directory, '../../../../node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs/package.json')],
    ['@firecrawl/pdf-inspector@1.12.0', process.env.CRUX_PDF_INSPECTOR_PACKAGE_JSON ?? resolve(directory, '../../../../node_modules/.pnpm/@firecrawl+pdf-inspector@1.12.0/node_modules/@firecrawl/pdf-inspector/package.json')],
    ['pdfjs-dist@5.7.284', process.env.CRUX_PDFJS_PACKAGE_JSON ?? resolve(directory, '../../../../node_modules/.pnpm/pdfjs-dist@5.7.284/node_modules/pdfjs-dist/package.json')],
    ['@firecrawl/pdf-inspector-linux-x64-gnu@1.12.0', process.env.CRUX_PDF_INSPECTOR_NATIVE_PACKAGE_JSON ?? resolve(directory, '../../../../node_modules/.pnpm/@firecrawl+pdf-inspector-linux-x64-gnu@1.12.0/node_modules/@firecrawl/pdf-inspector-linux-x64-gnu/package.json')],
  ]
  const pdfNativeArtifact = process.env.CRUX_PDF_INSPECTOR_NATIVE_ARTIFACT
    ?? resolve(directory, '../../../../node_modules/.pnpm/@firecrawl+pdf-inspector-linux-x64-gnu@1.12.0/node_modules/@firecrawl/pdf-inspector-linux-x64-gnu/pdf-inspector.linux-x64-gnu.node')
  const hash = createHash('sha256')
  hash.update('admission-evidence-schema:3\nrunner:family-v3\nassertions:native-raw-v3\n')
  hash.update(`${process.platform}:${process.arch}:node-${process.versions.node.split('.')[0]}\ncontainment:${hardMemoryContainment}\n`)
  for (const file of [...files, ...coreProjectors]) await hashFile(hash, file, resolve(directory, file))
  for (const [label, file] of await fixtureFiles()) await hashFile(hash, label, file)
  await hashFile(hash, '@firecrawl/anydoc-linux-x64-gnu@0.1.7/native', nativeArtifact)
  await hashFile(hash, '@firecrawl/anydoc@0.1.7/package.json', packageJson)
  for (const [identity, path] of incumbentPackages) await hashFile(hash, `${identity}/package.json`, path)
  await hashFile(hash, '@firecrawl/pdf-inspector-linux-x64-gnu@1.12.0/native', pdfNativeArtifact)
  const lockfile = await readFile(process.env.CRUX_ANYDOC_LOCKFILE ?? resolve(directory, '../../../../pnpm-lock.yaml'), 'utf8')
  for (const identity of ['@firecrawl/anydoc@0.1.7', 'mammoth@1.12.0', 'csv-parse@6.2.1', 'exceljs@4.4.0', '@firecrawl/pdf-inspector@1.12.0', 'pdfjs-dist@5.7.284', '@firecrawl/pdf-inspector-linux-x64-gnu@1.12.0']) {
    const integrity = lockfileIntegrity(lockfile, identity)
    if (!integrity) throw new Error(`Could not determine the installed ${identity} tarball integrity.`)
    hash.update(`${identity} tarball-integrity:${integrity}\n`)
  }
  return hash.digest('hex')
}

function lockfileIntegrity(lockfile, identity) {
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return lockfile.match(new RegExp(`(?:'${escaped}'|${escaped}):\\n\\s+resolution: \\{integrity: ([^}]+)\\}`))?.[1]
}

async function fixtureFiles() {
  const files = await filesUnder(resolve(directory, 'fixtures'))
  files.push(resolve(directory, '../../__tests__/fixtures/layout-aware-mixed.pdf'))
  return files.sort().map((file) => [`fixture:${file.startsWith(directory) ? file.slice(directory.length + 1) : file.split('/').at(-1)}`, file])
}

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(child))
    else if (entry.isFile()) files.push(child)
  }
  return files
}

async function hashFile(hash, label, path) {
  const bytes = await readFile(path)
  const info = await stat(path)
  hash.update(`${label}:${info.size}:${createHash('sha256').update(bytes).digest('hex')}\n`)
}

function containmentUnavailableCandidate(parser, fixtureId) {
  const assertion = { id: 'containment', role: 'required', passed: false, expected: 'verified hard memory containment', actual: 'unavailable' }
  const facts = { fixtureId, passed: false, admitted: false, assertions: [assertion] }
  return {
    parser,
    selected: false,
    outcome: { kind: 'failure', error: 'containment-unavailable' },
    hashes: {},
    native: facts,
    core: facts,
    projectionLosses: [],
    rolloutBudgetGate: false,
    p95: { wallMilliseconds: 0 },
  }
}
