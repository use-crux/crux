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
mod definition;
mod eval {
    pub(crate) mod assertions;
    pub(crate) mod facts;
}
mod flow {
    pub(crate) mod facts;
    pub(crate) mod output;
}
mod injection {
    pub(crate) mod injectable;
    pub(crate) mod model;
    pub(crate) mod tools;
}
pub mod manifest;
#[cfg(test)]
mod manifest_tests;
mod memory {
    pub(crate) mod block_metadata;
    pub(crate) mod blocks;
    pub(crate) mod facts;
    pub(crate) mod id;
    pub(crate) mod store;
}
mod prompt {
    pub(crate) mod facts;
}
pub mod projection;
mod rag {
    pub(crate) mod facts;
    pub(crate) mod metadata;
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
    pub(crate) mod router;
    pub(crate) mod source_refs;
}
mod runtime {
    pub(crate) mod flow;
    pub(crate) mod join;
    pub(crate) mod memory;
}
mod safety {
    pub(crate) mod facts;
}
mod schema;
mod scorer {
    pub(crate) mod facts;
}
mod source_refs;
mod tool {
    pub(crate) mod facts;
}
mod workspace {
    pub(crate) mod facts;
}
