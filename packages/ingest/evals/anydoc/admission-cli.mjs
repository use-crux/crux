import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build, stop } from 'esbuild'

const directory = dirname(fileURLToPath(import.meta.url))
const worker = resolve(directory, '../../node_modules/.cache/crux-anydoc-eval/admission-family-worker.mjs')
const resultDirectory = resolve(directory, '../../node_modules/.cache/crux-anydoc-eval/families')
const allFormats = ['csv', 'doc', 'docm', 'docx', 'epub', 'ods', 'odt', 'pdf', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx']
const formats = process.env.CRUX_ANYDOC_FORMATS?.split(',').filter((format) => allFormats.includes(format)) ?? allFormats
const execute = promisify(execFile)
const hardMemoryContainment = await hasHardMemoryContainment()

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
    family = validateFamily(JSON.parse(await readFile(resultPath, 'utf8')), format)
  } catch {
    const arguments_ = [worker, format]
    if (!hardMemoryContainment && format === 'pptx') arguments_.push('--containment-unavailable')
    const { stdout } = await execute(process.execPath, arguments_, {
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CRUX_ANYDOC_EVAL_DIRECTORY: directory },
    })
    family = validateFamily(JSON.parse(stdout), format)
    const temporary = `${resultPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(family)}\n`)
    await rename(temporary, resultPath)
  }
  families.push(family)
}

const docx = families.find((family) => family.results.some((result) => result.format === 'docx'))
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  runner: { maxConcurrentChildren: 1, productionEquivalent: false, hardMemoryContainment },
  results: families.flatMap((family) => family.results),
  formats: families.flatMap((family) => family.formats).map((decision) =>
    !hardMemoryContainment && decision.parser === 'anydoc'
      ? { ...decision, admitted: false, blockers: [...new Set([...decision.blockers, 'hard-memory-containment'])] }
      : decision),
  docxDecision: docx?.docxDecision ?? { primary: null, reason: 'DOCX family evidence is unavailable.' },
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

function validateFamily(value, format) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.results) || !Array.isArray(value.formats)
    || value.results.some((result) => result.format !== format || typeof result.fixtureId !== 'string' || typeof result.sourceHashMatches !== 'boolean')) {
    throw new Error(`Invalid cached admission family result for ${format}.`)
  }
  return value
}
