import type { StaticSyntaxFrontend } from '../../../static/syntax-record/types'

const OXC_STATIC_SYNTAX_VERSION = 'oxc_parser@0.133.0+crux_static_index_group3.5'

/**
 * Syntax frontend identity emitted by the Rust/Oxc indexer worker.
 *
 * This is a logical cache and provenance identity. It intentionally does not
 * construct or supervise the Rust worker; production worker supervision lives
 * in Go.
 */
export const OXC_STATIC_SYNTAX_FRONTEND_IDENTITY = {
  name: 'oxc-rust',
  version: OXC_STATIC_SYNTAX_VERSION,
} as const satisfies StaticSyntaxFrontend['identity']
