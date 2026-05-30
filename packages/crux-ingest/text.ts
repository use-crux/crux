import { errorFromUnknown, failed, normalizeDocument, ok, sourceLoader } from './document'
import type { IngestDocument, SourceLoader } from './types'

export function textSource(
  input:
    | IngestDocument
    | IngestDocument[]
    | (Omit<IngestDocument, 'parts' | 'content'> & { content: string; parts?: IngestDocument['parts'] })
    | Array<Omit<IngestDocument, 'parts' | 'content'> & { content: string; parts?: IngestDocument['parts'] }>,
): SourceLoader {
  const documents = Array.isArray(input) ? input : [input]

  return sourceLoader(async function* () {
    for (const document of documents) {
      try {
        yield ok(normalizeDocument(document))
      } catch (error) {
        yield failed({
          namespace: document.namespace,
          sourceId: document.sourceId,
          error: errorFromUnknown(error, !document.namespace.trim() ? 'empty_namespace' : 'empty_source_id'),
        })
      }
    }
  })
}
