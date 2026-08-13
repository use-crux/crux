import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { fact, provenance, type NativeCoordinate, type NativeFact, type NativeProducer } from './native-fact-schema'

const PRODUCER: NativeProducer = { kind: 'parser', name: 'mammoth', version: '1.12.0', adapterVersion: '2' }

/** Extract eval evidence directly from Mammoth's HTML DOM and messages. */
export function extractMammothNativeFacts(html: string, _messages: readonly unknown[], bytes: Uint8Array): readonly NativeFact[] {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const coordinate: NativeCoordinate = { kind: 'document', documentSha256: hash }
  const $ = load(html)
  const facts: NativeFact[] = []
  const orderedText: string[] = []
  let block = 0
  const addProvenance = (path: string) => facts.push(provenance(path, coordinate, PRODUCER))

  $('body').children().each((_, element) => {
    const tag = element.tagName.toLowerCase()
    const text = normalize($(element).text())
    if (!text) return
    block += 1
    const path = `blocks/${block}`
    addProvenance(path)
    if (/^h[1-6]$/.test(tag)) facts.push(fact(path, { kind: 'heading', level: Number(tag.slice(1)), text }))
    if (tag === 'table') {
      const rows: string[][] = []
      $(element).find('tr').each((__, row) => {
        rows.push($(row).children('th,td').map((___, cell) => normalize($(cell).text())).get())
      })
      const headerRows = $(element).find('tr').first().children().toArray().every((cell) => cell.tagName.toLowerCase() === 'th') ? 1 : 0
      facts.push(fact(path, { kind: 'table', columns: headerRows ? rows[0] ?? [] : [], rows }))
      orderedText.push(...rows.flat())
      return
    }
    if (tag === 'ol' || tag === 'ul') {
      const values = $(element).children('li').map((__, item) => normalize($(item).clone().children('ol,ul').remove().end().text())).get()
      facts.push(fact(path, { kind: 'list', ordered: tag === 'ol', depth: 1, text: values }))
      orderedText.push(...values)
      return
    }
    orderedText.push(text)
    $(element).find('a[href]').each((__, anchor) => {
      facts.push(fact(path, { kind: 'link', text: normalize($(anchor).text()), target: $(anchor).attr('href') ?? '' }))
    })
  })
  return [
    fact('document', { kind: 'ordered-text', text: orderedText }), fact('document', { kind: 'notes', text: [] }),
    fact('document', { kind: 'asset-count', count: 0 }), fact('document', { kind: 'coordinate-kinds', kinds: ['document'] }),
    fact('document', { kind: 'no-parser-downgrade' }), provenance('document', coordinate, PRODUCER), ...facts,
  ]
}

function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim() }
