import type { StaticSyntaxFrontend } from './types'

const RUST_OXC_VERSION = 'oxc_parser@0.133.0+crux_native_group3.5'

/**
 * Syntax frontend identity emitted by the native Rust/Oxc worker.
 *
 * This is a logical cache and provenance identity. It intentionally does not
 * construct or supervise the Rust worker; production native AST supervision
 * lives in Go.
 */
export const RUST_OXC_STATIC_SYNTAX_FRONTEND_IDENTITY = {
  name: 'oxc-rust',
  version: RUST_OXC_VERSION,
} as const satisfies StaticSyntaxFrontend['identity']
