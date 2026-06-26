//! Compatibility facades for legacy worker protocols.
//!
//! Static Index callers should use [`crate::pipeline`] for compiler stages.
//! This module keeps older worker response shapes available without moving
//! parsing or primitive projection back into transport code.

pub mod static_syntax;

pub use static_syntax::parse_static_syntax_record;
