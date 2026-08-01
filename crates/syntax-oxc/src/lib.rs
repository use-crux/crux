//! Oxc-backed TypeScript syntax frontend for the Crux Project Indexer.
//!
//! The crate converts source text into backend-neutral static syntax evidence.
//! It deliberately does not know about Project Index fact projection, linting,
//! or worker transport.

pub(crate) use crux_indexer_protocol as protocol;

/// Frontend identity name emitted in static syntax records.
pub const FRONTEND_NAME: &str = "oxc-rust";

/// Frontend identity version emitted in static syntax records.
pub const FRONTEND_VERSION: &str = "oxc_parser@0.139.0+crux_native_group3.12";

pub mod completion;
mod completion_ast;
mod completion_classify;
mod completion_existing;
mod completion_import_edits;
mod completion_import_paths;
mod completion_imports;
mod completion_items;
pub mod prompt_text;

pub mod frontend {
    //! Public parser entry points.

    pub use crate::syntax::frontend::parse_source;
}

mod syntax {
    pub(crate) mod argument_values;
    pub(crate) mod binding_symbols;
    pub(crate) mod frontend;
    pub(crate) mod function_calls;
    pub(crate) mod function_values;
    pub(crate) mod imports;
    pub(crate) mod initializers;
    pub(crate) mod interface_hash;
    pub(crate) mod match_arguments;
    pub(crate) mod match_build;
    pub(crate) mod match_expressions;
    pub(crate) mod match_interests;
    pub(crate) mod match_statements;
    pub(crate) mod object_values;
    pub(crate) mod resolve;
    pub(crate) mod semantic_imports;
    pub(crate) mod semantic_initializer_walk;
    pub(crate) mod semantic_initializers;
    pub(crate) mod source;
    pub(crate) mod values;
}

pub use frontend::parse_source;

#[cfg(test)]
mod completion_declarative_tests;
#[cfg(test)]
mod completion_identity_tests;
#[cfg(test)]
mod completion_import_safety_tests;
#[cfg(test)]
mod completion_import_tests;
#[cfg(test)]
mod completion_ranking_tests;
#[cfg(test)]
mod completion_slots_tests;
#[cfg(test)]
mod completion_tests;
#[cfg(test)]
mod tagged_template_tests;
#[cfg(test)]
mod tests;
