import type {
  PromptTextPreviewReadyResult,
  PromptTextPreviewServerUnavailableReason,
  PromptTextPreviewSlot,
  PromptTextPreviewUnavailableReason,
} from './types.js'

export const promptTextPreviewMetadataCommand =
  'crux.promptText.previewMetadata'
export const promptTextPreviewCapacityMessage =
  'Crux already has 16 static previews open. Close one before opening another.'
export const promptTextPreviewEOLMessage =
  'VS Code cannot preserve this preview’s exact line-ending bytes.'

/** Canonical path/query components for one private virtual Markdown document. */
export interface PromptTextPreviewResourceIdentity {
  readonly path: string
  readonly query: string
  readonly title: string
}

export type PromptTextPreviewMetadata =
  | {
      readonly kind: 'ready'
      readonly sourcePath: string
      readonly line: number
      readonly ready: PromptTextPreviewReadyResult
    }
  | {
      readonly kind: 'refreshing'
      readonly sourcePath: string
      readonly line: number
    }
  | {
      readonly kind: 'unavailable'
      readonly sourcePath: string
      readonly line: number
      readonly reason: PromptTextPreviewUnavailableReason
    }

/**
 * Remove private path context while retaining a recognizable ASCII basename.
 */
export function sanitizePreviewSourceLabel(sourcePath: string): string {
  const basename = sourcePath.split('/').at(-1) ?? ''
  const replaced = basename.replace(/[^A-Za-z0-9._-]+/gu, '-')
  const trimmed = replaced.replace(/^[._-]+|[._-]+$/gu, '')
  return trimmed.slice(0, 40) || 'source'
}

/** Build the exact URI path and tab title frozen at slot allocation. */
export function createPreviewResourceIdentity(
  slot: PromptTextPreviewSlot,
): PromptTextPreviewResourceIdentity {
  const source = sanitizePreviewSourceLabel(slot.sourcePath)
  const title = `Static preview — ${source} L${slot.initialLine} — ${slot.id}.md`
  return {
    path: `/${title}`,
    query: `slot=${slot.id}`,
    title,
  }
}

/** Build CodeLens-only metadata without adding bytes to the preview document. */
export function createPreviewMetadataTitle(
  metadata: PromptTextPreviewMetadata,
): string {
  const source = sanitizePreviewSourceLabel(metadata.sourcePath)
  const location = `${source}:${metadata.line}`
  if (metadata.kind === 'refreshing') {
    return `Static preview — refreshing · ${location}`
  }
  if (metadata.kind === 'unavailable') {
    return `Static preview — unavailable · ${location} · ${metadata.reason}`
  }
  const { ready } = metadata
  let title =
    'Static preview — unknown values are placeholders' +
    ` · ${location} · ${ready.evidence}` +
    ` · request ${ready.requestStatus}` +
    ` · template ${ready.templateStatus}` +
    ` · preview ${ready.previewStatus}`
  if (ready.truncation?.reason === 'max-preview-bytes') {
    title += ': max preview bytes'
  } else if (ready.truncation?.reason === 'max-fragment-depth') {
    title += ': max fragment depth'
  } else if (ready.previewStatus === 'complete' && ready.text.length === 0) {
    title += ' · empty'
  }
  return title
}

/** Map one server-owned unavailable reason to its explicit command message. */
export function promptTextPreviewUnavailableMessage(
  reason: PromptTextPreviewServerUnavailableReason,
): string {
  const messages = {
    'document-not-open': 'Open the source document before previewing it.',
    'revision-mismatch':
      'The source changed before the static preview completed. Try again.',
    'analysis-unavailable': 'Static preview is temporarily unavailable.',
    'request-unsupported': 'Static preview does not support this document.',
    'template-not-found':
      'No PromptText template was found at the selected location.',
    'template-ambiguous':
      'Crux could not uniquely identify the selected PromptText template.',
    'template-unsupported':
      'This PromptText template cannot be statically previewed.',
    'preview-unavailable':
      'Static preview is unavailable for this PromptText template.',
  } as const satisfies Record<PromptTextPreviewServerUnavailableReason, string>
  return messages[reason]
}
