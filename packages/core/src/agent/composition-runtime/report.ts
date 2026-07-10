import { observe } from '../../observability'
import type { CompositionKind, CompositionReport } from './types'

/** Emit a composition report artifact from the currently active composition span. */
export function emitCompositionReport(
  kind: CompositionKind,
  report: CompositionReport,
): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return

  const primitive = `composition.${kind}`
  const artifactId = observe.artifact({
    kind: 'composition.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: report.preview,
    attributes: {
      primitive,
      ...report.attributes,
    },
  })
  if (!artifactId) return

  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: {
      primitive,
      ...report.edgeAttributes,
    },
  })
}
