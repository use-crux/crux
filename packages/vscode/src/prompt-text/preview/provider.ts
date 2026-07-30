import {
  createPreviewMetadataTitle,
  createPreviewResourceIdentity,
  type PromptTextPreviewMetadata,
  type PromptTextPreviewResourceIdentity,
} from './metadata.js'
import type {
  PromptTextPreviewPublishResult,
  PromptTextPreviewReadyResult,
  PromptTextPreviewSlot,
  PromptTextPreviewUnavailableReason,
} from './types.js'

/** Narrow virtual-document shape needed for exact publication checks. */
export interface PromptTextPreviewDocument {
  readonly uri: string
  readonly languageId: string
  readonly eol: 'lf' | 'crlf'
  text: string
}

/** VS Code operations used by the content-provider state machine. */
export interface PromptTextPreviewProviderPorts {
  createUri(identity: PromptTextPreviewResourceIdentity): string
  openDocument(uri: string): Promise<PromptTextPreviewDocument>
  setMarkdownLanguage(
    document: PromptTextPreviewDocument,
  ): Promise<PromptTextPreviewDocument>
  refreshDocument(
    document: PromptTextPreviewDocument,
    expectedText: string,
  ): Promise<PromptTextPreviewDocument>
  showDocument(document: PromptTextPreviewDocument): Promise<void>
  contentChanged(uri: string): void
  codeLensesChanged(uri: string): void
}

interface PreviewResource {
  readonly slotId: number
  readonly uri: string
  readonly sourcePath: string
  publication: number
  content: string
  metadata: PromptTextPreviewMetadata
  language?: Promise<PromptTextPreviewDocument>
}

/**
 * Stores only active virtual resources and publishes exact content bytes.
 *
 * Opening, language establishment, EOL checks, provider refresh, and
 * post-publication equality complete before the editor becomes visible.
 */
export class PromptTextPreviewDocumentProvider {
  readonly #resourcesBySlot = new Map<number, PreviewResource>()
  readonly #resourcesByUri = new Map<string, PreviewResource>()

  constructor(private readonly ports: PromptTextPreviewProviderPorts) {}

  /** Return current resource bytes; unavailable and refreshing content is empty. */
  provideTextDocumentContent(uri: string): string | undefined {
    return this.#resourcesByUri.get(uri)?.content
  }

  /** Return metadata carried by the empty-document-safe CodeLens only. */
  provideCodeLensTitle(uri: string): string | undefined {
    const resource = this.#resourcesByUri.get(uri)
    return resource === undefined
      ? undefined
      : createPreviewMetadataTitle(resource.metadata)
  }

  /** Resolve a provider-owned URI to its active slot for close handling. */
  slotId(uri: string): number | undefined {
    return this.#resourcesByUri.get(uri)?.slotId
  }

  /** Resolve a slot to its stable virtual URI without allocating it. */
  resourceUri(slotId: number): string | undefined {
    return this.#resourcesBySlot.get(slotId)?.uri
  }

  /**
   * Publish bytes only after language, EOL, and post-refresh equality checks.
   * Superseded publications never reveal or dispose a newer resource.
   */
  async publish(
    slot: PromptTextPreviewSlot,
    ready: PromptTextPreviewReadyResult,
    reveal: boolean,
  ): Promise<PromptTextPreviewPublishResult> {
    const resource = this.#resource(slot)
    const publication = ++resource.publication
    let document: PromptTextPreviewDocument
    try {
      document = await this.ports.openDocument(resource.uri)
      if (document.languageId !== 'markdown') {
        document = await this.#establishMarkdown(resource, document)
      }
    } catch {
      if (this.#isCurrent(resource, publication)) {
        this.disposeSlot(resource.uri)
      }
      return 'resource-disposed'
    }
    if (!this.#isCurrent(resource, publication)) return 'resource-disposed'
    if (document.languageId !== 'markdown') {
      this.disposeSlot(resource.uri)
      return 'resource-disposed'
    }
    if (!isPreviewEOLCompatible(ready.text, document.eol)) {
      const cleared = await this.#markUnavailable(
        resource,
        document,
        'editor-eol-normalization',
        publication,
      )
      if (!this.#isCurrent(resource, publication)) return 'resource-disposed'
      if (reveal && cleared !== undefined) {
        await this.ports.showDocument(cleared)
      }
      return 'editor-eol-normalization'
    }

    resource.content = ready.text
    resource.metadata = {
      kind: 'ready',
      sourcePath: resource.sourcePath,
      line: ready.selection.range.start.line + 1,
      ready,
    }
    this.#signal(resource)
    const updated = await this.ports.refreshDocument(document, ready.text)
    if (!this.#isCurrent(resource, publication)) return 'resource-disposed'
    if (updated.text !== ready.text) {
      const cleared = await this.#markUnavailable(
        resource,
        updated,
        'editor-eol-normalization',
        publication,
      )
      if (!this.#isCurrent(resource, publication)) return 'resource-disposed'
      if (reveal && cleared !== undefined) {
        await this.ports.showDocument(cleared)
      }
      return 'editor-eol-normalization'
    }
    if (reveal) await this.ports.showDocument(updated)
    return 'exact'
  }

  /** Clear bytes synchronously and expose only an unavailable CodeLens reason. */
  clear(
    slot: PromptTextPreviewSlot,
    reason: PromptTextPreviewUnavailableReason,
  ): void {
    const resource = this.#resourcesBySlot.get(slot.id)
    if (resource === undefined) return
    ++resource.publication
    resource.content = ''
    resource.metadata = {
      kind: 'unavailable',
      sourcePath: resource.sourcePath,
      line: slot.range.start.line + 1,
      reason,
    }
    this.#signal(resource)
  }

  /** Clear bytes synchronously while an exact retained slot is being repulled. */
  refreshing(slot: PromptTextPreviewSlot): void {
    const resource = this.#resourcesBySlot.get(slot.id)
    if (resource === undefined) return
    ++resource.publication
    resource.content = ''
    resource.metadata = {
      kind: 'refreshing',
      sourcePath: resource.sourcePath,
      line: slot.range.start.line + 1,
    }
    this.#signal(resource)
  }

  /** Forget one provider resource after its final virtual document closes. */
  disposeSlot(uri: string): void {
    const resource = this.#resourcesByUri.get(uri)
    if (resource === undefined) return
    this.#resourcesByUri.delete(uri)
    this.#resourcesBySlot.delete(resource.slotId)
  }

  /** Forget all provider resources during extension deactivation. */
  dispose(): void {
    this.#resourcesByUri.clear()
    this.#resourcesBySlot.clear()
  }

  #resource(slot: PromptTextPreviewSlot): PreviewResource {
    const existing = this.#resourcesBySlot.get(slot.id)
    if (existing !== undefined) return existing
    const identity = createPreviewResourceIdentity(slot)
    const resource: PreviewResource = {
      slotId: slot.id,
      uri: this.ports.createUri(identity),
      sourcePath: slot.sourcePath,
      publication: 0,
      content: '',
      metadata: {
        kind: 'refreshing',
        sourcePath: slot.sourcePath,
        line: slot.range.start.line + 1,
      },
    }
    this.#resourcesBySlot.set(slot.id, resource)
    this.#resourcesByUri.set(resource.uri, resource)
    return resource
  }

  async #markUnavailable(
    resource: PreviewResource,
    document: PromptTextPreviewDocument,
    reason: PromptTextPreviewUnavailableReason,
    publication: number,
  ): Promise<PromptTextPreviewDocument | undefined> {
    resource.content = ''
    resource.metadata = {
      kind: 'unavailable',
      sourcePath: resource.sourcePath,
      line: resource.metadata.line,
      reason,
    }
    this.#signal(resource)
    let cleared = document
    while (cleared.text !== '') {
      if (!this.#isCurrent(resource, publication)) return undefined
      cleared = await this.ports.refreshDocument(cleared, '')
    }
    return cleared
  }

  async #establishMarkdown(
    resource: PreviewResource,
    document: PromptTextPreviewDocument,
  ): Promise<PromptTextPreviewDocument> {
    if (resource.language !== undefined) return resource.language
    const pending = this.ports.setMarkdownLanguage(document)
    resource.language = pending
    try {
      return await pending
    } finally {
      if (resource.language === pending) resource.language = undefined
    }
  }

  #signal(resource: PreviewResource): void {
    this.ports.contentChanged(resource.uri)
    this.ports.codeLensesChanged(resource.uri)
  }

  #isCurrent(resource: PreviewResource, publication: number): boolean {
    return (
      resource.publication === publication &&
      this.#resourcesBySlot.get(resource.slotId) === resource
    )
  }
}

/** True only when VS Code's established EOL cannot rewrite any input byte. */
export function isPreviewEOLCompatible(
  text: string,
  eol: PromptTextPreviewDocument['eol'],
): boolean {
  if (eol === 'lf') return !text.includes('\r')
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '\r' && text[index + 1] !== '\n') return false
    if (character === '\n' && text[index - 1] !== '\r') return false
  }
  return true
}
