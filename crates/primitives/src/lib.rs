//! First-party Crux Project Index extractor application logic.
//!
//! This crate owns domain projection from static syntax evidence into native
//! static fact packets. It does not own worker transport or compiler
//! finalization.

pub(crate) use crux_indexer_protocol as protocol;

mod agent {
    pub(crate) mod convex;
    pub(crate) mod facts;
    pub(crate) mod metadata;
}
mod blackboard {
    pub(crate) mod facts;
}
mod composition {
    pub(crate) mod facts;
    pub(crate) mod output;
    pub(crate) mod relations;
    pub(crate) mod values;
}
mod context;
mod data {
    pub(crate) mod access;
    pub(crate) mod output;
}
mod defer;
mod definition;
mod effect;
mod embedding {
    pub(crate) mod call;
    pub(crate) mod core;
    pub(crate) mod core_values;
    pub(crate) mod facts;
    pub(crate) mod identity;
    pub(crate) mod provider;
    pub(crate) mod provider_defaults;
    pub(crate) mod provider_values;
    pub(crate) mod safe_definition;
}
mod eval {
    pub(crate) mod assertions;
    pub(crate) mod facts;
}
mod evidence_record {
    pub(crate) mod facts;
}
mod flow {
    pub(crate) mod facts;
    pub(crate) mod output;
    pub(crate) mod runtime_metadata;
}
mod injection {
    pub(crate) mod injectable;
    pub(crate) mod model;
    pub(crate) mod tools;
}
pub mod completion;
pub mod manifest;
#[cfg(test)]
mod manifest_tests;
pub mod producer_identity;
mod media {
    pub(crate) mod facts;
    pub(crate) mod ingest;
}
mod memory {
    pub(crate) mod block_metadata;
    pub(crate) mod blocks;
    pub(crate) mod facts;
    pub(crate) mod id;
    pub(crate) mod store;
}
mod mcp {
    pub(crate) mod facts;
}
mod prompt {
    pub(crate) mod facts;
    #[cfg(test)]
    mod tests;
}
pub mod projection;
mod rag {
    pub(crate) mod facts;
    pub(crate) mod indexer;
    pub(crate) mod metadata;
    pub(crate) mod recipe_steps;
}
mod record_values;
mod registry {
    pub(crate) mod facts;
}
mod routing {
    pub(crate) mod cascade;
    pub(crate) mod facts;
    pub(crate) mod fallback;
    pub(crate) mod output;
    pub(crate) mod retry;
    pub(crate) mod router;
    pub(crate) mod source_refs;
    pub(crate) mod split;
}
mod runtime {
    pub(crate) mod flow;
    pub(crate) mod join;
    pub(crate) mod memory;
    pub(crate) mod task;
}
mod safety {
    pub(crate) mod classifier;
    pub(crate) mod facts;
    pub(crate) mod metadata;
}
mod schema;
mod scorer {
    pub(crate) mod facts;
}
mod signal;
mod session {
    pub(crate) mod facts;
}
mod source_refs;
mod storage {
    pub(crate) mod capabilities;
    pub(crate) mod dependencies;
    pub(crate) mod facts;
    pub(crate) mod metadata;
}
mod tool {
    pub(crate) mod facts;
}
mod thread {
    pub(crate) mod facts;
}
mod workspace {
    pub(crate) mod facts;
}
