import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import ExcelJS from 'exceljs'

const root = new URL('.', import.meta.url).pathname
const generators = join(root, 'generators')
const fixtures = join(root, 'fixtures')
const profile = mkdtempSync(join(tmpdir(), 'crux-anydoc-lo-'))

try {
  for (const [input, formats] of [['prose.fodt', ['docx', 'doc', 'docm', 'odt', 'rtf', 'epub']]]) {
    for (const format of formats) {
      convert(join(generators, input), format)
    }
  }
  await createWorkbook()
  for (const name of ['prose.docx', 'prose.docm', 'prose.odt', 'prose.epub', 'sheet.xlsx']) {
    normalizeZip(join(fixtures, name))
  }
  cpSync(join(generators, 'hostile.rtf'), join(fixtures, 'mislabeled.docx'))
  const docx = readFileSync(join(fixtures, 'prose.docx'))
  writeFileSync(join(fixtures, 'truncated.docx'), docx.subarray(0, 32))
  writeFileSync(join(fixtures, 'malformed.docx'), Buffer.from('PK\x03\x04not-a-document'))
  encryptDocx()
} finally {
  rmSync(profile, { recursive: true, force: true })
}

function convert(input, format) {
  execFileSync('soffice', [
    '--headless',
    `-env:UserInstallation=file://${profile}`,
    '--convert-to', format,
    '--outdir', fixtures,
    input,
  ], { stdio: 'pipe' })
  const output = join(fixtures, `${basename(input, input.slice(input.lastIndexOf('.')))}.${format}`)
  if (!existsSync(output)) {
    throw new Error(`LibreOffice did not create ${output}.`)
  }
}

function encryptDocx() {
  const directory = mkdtempSync(join(tmpdir(), 'crux-anydoc-encrypted-'))
  try {
    cpSync(join(fixtures, 'prose.docx'), join(directory, 'encrypted.docx'))
    execFileSync('zip', ['-q', '-P', 'crux', join(fixtures, 'encrypted.docx'), 'encrypted.docx'], { cwd: directory })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function normalizeZip(path) {
  const directory = mkdtempSync(join(tmpdir(), 'crux-anydoc-zip-'))
  try {
    execFileSync('unzip', ['-qq', path, '-d', directory])
    normalizeTimes(directory)
    rmSync(path)
    execFileSync('zip', ['-X', '-q', '-r', path, '.'], { cwd: directory })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function normalizeTimes(path) {
  const timestamp = new Date('1980-01-01T00:00:00.000Z')
  for (const name of readdirSync(path)) {
    const child = join(path, name)
    if (statSync(child).isDirectory()) {
      normalizeTimes(child)
    }
    utimesSync(child, timestamp, timestamp)
  }
}

async function createWorkbook() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Crux fixture generator'
  workbook.created = new Date('2000-01-01T00:00:00.000Z')
  workbook.modified = workbook.created
  const sheet = workbook.addWorksheet('Pricing')
  sheet.addRow(['Plan', 'Price'])
  sheet.addRow(['Pro', 20])
  await workbook.xlsx.writeFile(join(fixtures, 'sheet.xlsx'))
}
