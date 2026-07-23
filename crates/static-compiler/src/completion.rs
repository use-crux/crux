//! Transient compiler completion facade.
//!
//! Unlike [`crate::pipeline`], this path never emits facts, patches, telemetry,
//! or cache writes. It delegates one unsaved source snapshot to the Oxc query.

use crux_indexer_protocol::completion::{CompletionQueryRequest, CompletionQueryResponse};

/// Runs one cache-bypassing completion query.
pub fn complete(request: CompletionQueryRequest) -> CompletionQueryResponse {
    crux_indexer_syntax_oxc::completion::complete(request)
}
