import { createHash } from 'node:crypto'
import type { PromptTextDocumentStamp } from './contracts.js'

/** Minimal source snapshot needed to create an exact decoration stamp. */
export interface PromptTextDocumentSnapshot {
  readonly uri: string
  readonly version: number
  readonly text: string
}

/**
 * Tracks URI-local open lifetimes independently from document versions.
 *
 * The language server observes the same open/close order for each synchronized
 * URI, so URI-local epochs remain stable regardless of other open documents.
 */
export class PromptTextDocumentRevisions {
  readonly #epochs = new Map<string, number>()
  readonly #open = new Set<string>()

  /**
   * Returns the exact current stamp, lazily establishing an initial open epoch.
   *
   * @param document - Current URI, LSP version, and exact UTF-8 source text.
   * @returns A self-verifying stamp suitable for the PromptText pull request.
   */
  stamp(document: PromptTextDocumentSnapshot): PromptTextDocumentStamp {
    this.open(document.uri)
    return {
      uri: document.uri,
      openEpoch: this.#epochs.get(document.uri) ?? 1,
      version: document.version,
      sourceHash: promptTextSourceHash(document.text),
    }
  }

  /**
   * Establishes an open lifetime without reading or hashing document text.
   *
   * @param uri - URI reported by the VS Code open-document lifecycle.
   */
  open(uri: string): void {
    if (this.#open.has(uri)) return
    this.#open.add(uri)
    this.#epochs.set(uri, (this.#epochs.get(uri) ?? 0) + 1)
  }

  /**
   * Retires one open lifetime while retaining its monotonic URI counter.
   *
   * @param uri - Closed document URI.
   */
  close(uri: string): void {
    this.#open.delete(uri)
  }
}

/**
 * Hash exact source bytes using the Project Index SHA-256 representation.
 *
 * @param text - Source text exactly as returned by VS Code.
 * @returns A lowercase, unprefixed hexadecimal digest.
 */
export function promptTextSourceHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
