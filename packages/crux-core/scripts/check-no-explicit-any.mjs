import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const ignoredDirs = new Set(['node_modules', '.turbo', '__tests__'])
const baselinePath = path.join(import.meta.dirname, 'explicit-any-baseline.json')
const updateBaseline = process.argv.includes('--update-baseline')
const files = collectSourceFiles(root)
const violations = []

for (const file of files) {
  const sourceText = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)

  visit(sourceFile, (node) => {
    if (node.kind !== ts.SyntaxKind.AnyKeyword) return
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      file: path.relative(root, file),
      line: line + 1,
      column: character + 1,
    })
  })
}

const current = violations.map((violation) => `${violation.file}:${violation.line}:${violation.column}`).sort()

if (updateBaseline) {
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify(
      {
        description:
          'Existing explicit any usages in @crux/core production source. New usages fail typecheck; shrink this file as legacy surfaces are hardened.',
        entries: current,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`Wrote ${current.length} explicit any baseline entr${current.length === 1 ? 'y' : 'ies'}.`)
  process.exit(0)
}

const baseline = readBaseline()
const allowed = new Set(baseline.entries)
const newViolations = current.filter((entry) => !allowed.has(entry))
const staleBaselineEntries = baseline.entries.filter((entry) => !current.includes(entry))

if (newViolations.length > 0 || staleBaselineEntries.length > 0) {
  if (newViolations.length > 0) {
    console.error(`Found ${newViolations.length} new explicit any usage(s) in @crux/core:`)
    for (const violation of newViolations) {
      console.error(`- ${violation}`)
    }
  }
  if (staleBaselineEntries.length > 0) {
    console.error(
      `Found ${staleBaselineEntries.length} stale explicit any baseline entr${
        staleBaselineEntries.length === 1 ? 'y' : 'ies'
      }. Run pnpm --filter @crux/core typecheck:any:update after removing explicit any usage.`,
    )
    for (const entry of staleBaselineEntries) {
      console.error(`- ${entry}`)
    }
  }
  process.exit(1)
}

function collectSourceFiles(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(absolute, result)
      continue
    }
    if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      result.push(absolute)
    }
  }
  return result
}

function visit(node, fn) {
  fn(node)
  ts.forEachChild(node, (child) => visit(child, fn))
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) {
    return { entries: [] }
  }
  const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid explicit any baseline file.')
  }
  return { entries: parsed.entries.filter((entry) => typeof entry === 'string').sort() }
}
