import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { build, stop } from 'esbuild'

const directory = dirname(fileURLToPath(import.meta.url))
const worker = resolve(directory, '../../node_modules/.cache/crux-anydoc-eval/admission-family-worker.mjs')
const resultDirectory = resolve(directory, '../../node_modules/.cache/crux-anydoc-eval/families')
const allFormats = ['csv', 'doc', 'docm', 'docx', 'epub', 'ods', 'odt', 'pdf', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx']
const formats = process.env.CRUX_ANYDOC_FORMATS?.split(',').filter((format) => allFormats.includes(format)) ?? allFormats
const execute = promisify(execFile)
const hardMemoryContainment = await hasHardMemoryContainment()
const cacheIdentity = await evidenceCacheIdentity()

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
    family = validateFamily(JSON.parse(await readFile(resultPath, 'utf8')), format, cacheIdentity)
  } catch {
    const arguments_ = [worker, format]
    if (!hardMemoryContainment) arguments_.push('--containment-unavailable')
    const { stdout } = await execute(process.execPath, arguments_, {
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CRUX_ANYDOC_EVAL_DIRECTORY: directory },
    })
    family = { ...validateFamily(JSON.parse(stdout), format), cacheIdentity }
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

async function hasHardMemoryContainment() {
  try {
    await access('/sys/fs/cgroup/memory.max')
    const { readFile } = await import('node:fs/promises')
    const value = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim()
    return value !== '' && value !== 'max' && Number.isSafeInteger(Number(value)) && Number(value) > 0
  } catch {
    return false
  }
}

function validateFamily(value, format, identity) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.results) || !Array.isArray(value.formats)
    || (identity !== undefined && value.cacheIdentity !== identity)
    || value.results.some((result) => result.format !== format || typeof result.fixtureId !== 'string' || typeof result.sourceHashMatches !== 'boolean')) {
    throw new Error(`Invalid cached admission family result for ${format}.`)
  }
  return value
}

async function evidenceCacheIdentity() {
  const files = [
    'admission-family-worker.ts', 'admission-suite.ts', 'anydoc-worker.mjs', 'expected-facts.ts',
    'fixture-manifest.ts', 'incumbent-worker.ts', 'sequential-runner.ts', 'structural-assertions.ts',
  ]
  const hash = createHash('sha256')
  hash.update('admission-evidence-schema:2\nrunner:family-v2\nassertions:native-raw-v2\n')
  hash.update(`${process.platform}:${process.arch}:node-${process.versions.node}\ncontainment:${hardMemoryContainment}\n`)
  for (const file of files) hash.update(await readFile(resolve(directory, file)))
  hash.update(await readFile(resolve(directory, '../../../../pnpm-lock.yaml')))
  return hash.digest('hex')
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
