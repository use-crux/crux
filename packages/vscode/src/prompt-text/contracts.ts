import type { PromptTextDecorationRole } from './types.js'

/** A zero-based UTF-16 position matching VS Code and LSP coordinates. */
export interface Utf16Position {
  readonly line: number
  readonly character: number
}

/**
 * A half-open source range measured in zero-based UTF-16 positions.
 *
 * JavaScript string indices use the same code-unit convention, so the client
 * can map these positions without interpreting Markdown or TypeScript.
 */
export interface Utf16Range {
  readonly start: Utf16Position
  readonly end: Utf16Position
}

/** One visual role assigned to an already-proven literal source range. */
export interface PromptTextDecorationSpan {
  readonly role: PromptTextDecorationRole
  readonly range: Utf16Range
}

/** Exact editor-buffer identity shared by decoration requests and responses. */
export interface PromptTextDocumentStamp {
  readonly uri: string
  readonly openEpoch: number
  readonly version: number
  readonly sourceHash: string
}

/** Pull request for decorations derived from one exact editor buffer. */
export interface PromptTextDecorationRequest extends PromptTextDocumentStamp {
  readonly protocolVersion: 1
}

/**
 * Complete decoration replacement for one exact editor buffer.
 *
 * An explicit empty `decorations` array is the clear operation.
 */
export interface PromptTextDecorationResult extends PromptTextDocumentStamp {
  readonly protocolVersion: 1
  readonly decorations: readonly PromptTextDecorationSpan[]
}

/**
 * Phase-one client fixture for exercising mapped editor decorations.
 *
 * This is intentionally not the Rust or LSP wire contract. The later
 * end-to-end phase may replace the fixture source while preserving the client
 * role and UTF-16 range boundary.
 */
export interface PromptTextDecorationFixture {
  readonly kind: 'prompt-text-decoration-fixture'
  readonly protocolVersion: 1
  readonly units: 'utf-16'
  readonly document: {
    readonly uri: string
    readonly version: number
    readonly text: string
  }
  readonly decorations: readonly PromptTextDecorationSpan[]
}
