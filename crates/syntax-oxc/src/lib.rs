//! Oxc-backed TypeScript syntax frontend for the Crux Project Indexer.
//!
//! The crate converts source text into backend-neutral static syntax evidence.
//! It deliberately does not know about Project Index fact projection, linting,
//! or worker transport.

pub(crate) use crux_indexer_protocol as protocol;

/// Frontend identity name emitted in static syntax records.
pub const FRONTEND_NAME: &str = "oxc-rust";

/// Frontend identity version emitted in static syntax records.
pub const FRONTEND_VERSION: &str = "oxc_parser@0.133.0+crux_native_group3.5";

pub mod frontend {
    //! Public parser entry points.

    pub use crate::syntax::frontend::parse_source;
}

mod syntax {
    pub(crate) mod argument_values;
    pub(crate) mod frontend;
    pub(crate) mod function_calls;
    pub(crate) mod function_values;
    pub(crate) mod imports;
    pub(crate) mod initializers;
    pub(crate) mod match_arguments;
    pub(crate) mod match_build;
    pub(crate) mod match_expressions;
    pub(crate) mod match_interests;
    pub(crate) mod match_statements;
    pub(crate) mod object_values;
    pub(crate) mod resolve;
    pub(crate) mod source;
    pub(crate) mod values;
}

pub use frontend::parse_source;

#[cfg(test)]
mod tests;
