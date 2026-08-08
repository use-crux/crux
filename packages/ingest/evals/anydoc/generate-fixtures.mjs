import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import XLSX from 'xlsx'

// Convenience provenance only. Checked-in fixture hashes, not regenerated
// output, are the canonical eval inputs because office generators may include
// version- or environment-specific package metadata.

const root = new URL('.', import.meta.url).pathname
const generators = join(root, 'generators')
const fixtures = join(root, 'fixtures')
const profile = mkdtempSync(join(tmpdir(), 'crux-anydoc-lo-'))

try {
  for (const [input, formats] of [['prose.fodt', ['docx', 'doc', 'odt', 'rtf', 'epub']]]) {
    for (const format of formats) {
      convert(join(generators, input), format)
    }
  }
  await enrichDocx()
  await createPresentation()
  await createLegacyWorkbooks()
  await createWorkbook()
  await createExternalLinkFixture()
  await createExpansionHeavyFixture()
  for (const name of [
    'prose.docx',
    'prose.odt',
    'prose.epub',
    'slides.pptx',
    'sheet.xlsx',
    'external-link.docx',
    'expansion-heavy.docx',
  ]) {
    normalizeZip(join(fixtures, name))
  }
  cpSync(join(generators, 'hostile.rtf'), join(fixtures, 'mislabeled.docx'))
  const docx = readFileSync(join(fixtures, 'prose.docx'))
  writeFileSync(join(fixtures, 'truncated.docx'), docx.subarray(0, 32))
  writeFileSync(join(fixtures, 'malformed.docx'), Buffer.from('PK\x03\x04not-a-document'))
} finally {
  rmSync(profile, { recursive: true, force: true })
}

function convert(input, format) {
  const target = format === 'ppt' ? 'ppt:MS PowerPoint 97' : format === 'ods' ? 'ods:calc8' : format
  const output = join(fixtures, `${basename(input, input.slice(input.lastIndexOf('.')))}.${format}`)
  rmSync(output, { force: true })
  execFileSync(
    'soffice',
    ['--headless', `-env:UserInstallation=file://${profile}`, '--convert-to', target, '--outdir', fixtures, input],
    { stdio: 'pipe' },
  )
  if (!existsSync(output)) {
    throw new Error(`LibreOffice did not create ${output}.`)
  }
}

async function enrichDocx() {
  const path = join(fixtures, 'prose.docx')
  const zip = await JSZip.loadAsync(readFileSync(path))
  const contentTypes = await zip.file('[Content_Types].xml').async('string')
  const relationships = await zip.file('word/_rels/document.xml.rels').async('string')
  const document = await zip.file('word/document.xml').async('string')
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WcAAAAAElFTkSuQmCC',
    'base64',
  )

  zip.file(
    '[Content_Types].xml',
    contentTypes.replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
    ),
  )
  zip.file(
    'word/_rels/document.xml.rels',
    relationships.replace(
      '</Relationships>',
      [
        '<Relationship Id="rIdCruxImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/crux.png"/>',
        '<Relationship Id="rIdCruxFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>',
        '</Relationships>',
      ].join(''),
    ),
  )
  zip.file(
    'word/document.xml',
    document.replace(
      '</w:body>',
      [
        '<w:p><w:r><w:t>Illustrated evidence</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>',
        '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Crux pixel"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdCruxImage"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
        '</w:body>',
      ].join(''),
    ),
  )
  zip.file(
    'word/footnotes.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Crux footnote evidence.</w:t></w:r></w:p></w:footnote></w:footnotes>',
  )
  zip.file('word/media/crux.png', image)
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }))
}

async function createPresentation() {
  const pptx = new PptxGenJS()
  pptx.author = 'Crux'
  pptx.subject = 'Anydoc fixture'
  pptx.title = 'Ordered presentation evidence'
  pptx.company = 'Crux'
  pptx.lang = 'en-US'
  pptx.layout = 'LAYOUT_WIDE'
  const slide1 = pptx.addSlide()
  slide1.addText('Slide One', { x: 0.5, y: 0.3, w: 4, h: 0.5 })
  slide1.addTable(
    [
      ['Plan', 'Status'],
      ['Pro', 'Ready'],
    ],
    { x: 0.5, y: 1, w: 5, h: 1.5 },
  )
  slide1.addNotes('Owner note for slide one.')
  const slide2 = pptx.addSlide()
  slide2.addText('Slide Two', { x: 0.5, y: 0.3, w: 4, h: 0.5 })
  slide2.addImage({
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WcAAAAAElFTkSuQmCC',
    x: 0.5,
    y: 1,
    w: 1,
    h: 1,
  })
  slide2.addNotes('Owner note for slide two.')
  await pptx.writeFile({ fileName: join(fixtures, 'slides.pptx') })
}

async function createLegacyWorkbooks() {
  const workbook = XLSX.utils.book_new()
  const pricing = XLSX.utils.aoa_to_sheet([
    ['Plan', 'Price', 'Taxed'],
    ['Pro', 20, 24],
  ])
  pricing.C2 = { t: 'n', f: 'B2*1.2', v: 24 }
  pricing['!merges'] = [XLSX.utils.decode_range('A4:B4')]
  pricing.A4 = { t: 's', v: 'Merged total' }
  pricing['!ref'] = 'A1:C4'
  const regions = XLSX.utils.aoa_to_sheet([['Region'], ['EU']])
  XLSX.utils.book_append_sheet(workbook, pricing, 'Pricing')
  XLSX.utils.book_append_sheet(workbook, regions, 'Regions')
  XLSX.writeFile(workbook, join(fixtures, 'sheet.xls'), { bookType: 'biff8' })
  XLSX.writeFile(workbook, join(fixtures, 'sheet.ods'), { bookType: 'ods' })
  const ods = await JSZip.loadAsync(readFileSync(join(fixtures, 'sheet.ods')))
  const content = await ods.file('content.xml').async('string')
  ods.file(
    'content.xml',
    content.replace(
      '<table:table-cell office:value-type="string"><text:p>Merged total</text:p></table:table-cell><table:table-cell/>',
      '<table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>Merged total</text:p></table:table-cell><table:covered-table-cell/>',
    ),
  )
  writeFileSync(
    join(fixtures, 'sheet.ods'),
    await ods.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }),
  )
}

async function createExternalLinkFixture() {
  const zip = await JSZip.loadAsync(readFileSync(join(fixtures, 'prose.docx')))
  const relationships = await zip.file('word/_rels/document.xml.rels').async('string')
  zip.file(
    'word/_rels/document.xml.rels',
    relationships.replace(
      '</Relationships>',
      '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/crux-eval" TargetMode="External"/></Relationships>',
    ),
  )
  writeFileSync(
    join(fixtures, 'external-link.docx'),
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }),
  )
}

async function createExpansionHeavyFixture() {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${'EXPANSION'.repeat(64 * 1024)}</w:t></w:r></w:p></w:body></w:document>`,
  )
  writeFileSync(
    join(fixtures, 'expansion-heavy.docx'),
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
    }),
  )
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
