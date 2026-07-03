//! Built-in Crux Project Index lint application logic.
//!
//! This crate consumes normalized Static Index facts and appends built-in
//! findings. It does not own compiler finalization or worker transport.

pub(crate) use crux_indexer_facts as facts;

pub mod builder;
mod contracts;
mod emit;
pub mod filter;
pub mod findings;
mod helpers;
mod injection {
    pub(crate) mod entries;
    pub(crate) mod evidence;
    pub(crate) mod evidence_data;
    pub(crate) mod inputs;
    pub(crate) mod model;
    pub(crate) mod model_helpers;
    pub(crate) mod rules;
}
mod propagation;
mod rules {
    pub(crate) mod core;
    pub(crate) mod definition_tail;
    pub(crate) mod filter;
    pub(crate) mod relation;
    pub(crate) mod routing;
    pub(crate) mod runtime;
}
