/**
 * Target architecture tokens for the Rust/Go Static Index cleanup.
 *
 * These strings intentionally name architecture ownership boundaries, not
 * every source file that exists today. Later phases can move implementation
 * paths while this inventory keeps the committed docs pinned to the target
 * vocabulary.
 *
 * @module
 */

/** Path or package tokens that the committed architecture baseline must describe. */
export const architectureBaselineRequiredTokens = [
  'packages/indexer/src/contracts/worker-events',
  'packages/indexer/src/contracts/static-syntax',
  'packages/indexer/src/contracts/static-index',
  'packages/indexer/src/contracts/semantic',
  'packages/indexer/src/indexer/static-index/config',
  'packages/indexer/src/indexer/static-index/protocol',
  'packages/indexer/src/indexer/static-index/syntax',
  'packages/indexer/src/indexer/static-index/extension-host',
  'packages/indexer/src/indexer/static-index/compatibility/syntax-record-bridge',
  'packages/local-workers',
  '@use-crux/devtools',
  'packages/local/internal/projectindex/service',
  'packages/local/internal/projectindex/readmodel',
  'packages/local/internal/projectindex/eventwire',
  'packages/local/internal/projectindex/workers',
  'packages/local/internal/projectindex/workers/requestwire',
  'packages/local/internal/projectindex/workers/source',
  'packages/local/internal/projectindex/workers/semantic',
  'packages/local/internal/projectindex/workers/runtime',
  'packages/local/internal/projectindex/workers/node',
  'packages/local/internal/projectindex/staticindex/session',
  'packages/local/internal/projectindex/staticindex/planner',
  'packages/local/internal/projectindex/staticindex/sourceprofile',
  'packages/local/internal/projectindex/staticindex/cache',
  'packages/local/internal/projectindex/staticindex/frontend',
  'packages/local/internal/projectindex/staticindex/compiler',
  'packages/local/internal/projectindex/staticindex/protocol',
  'packages/local/internal/projectindex/staticindex/run',
  'crates/protocol/src/process.rs',
  'crates/protocol/src/static_syntax.rs',
  'crates/protocol/src/static_index.rs',
  'crates/protocol/src/project_index_events.rs',
  'crates/syntax-oxc',
  'crates/facts',
  'crates/primitives',
  'crates/lints',
  'crates/static-compiler',
  'crates/worker',
  'crux-static-index-worker',
] as const
