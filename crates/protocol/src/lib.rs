//! Wire protocol types shared by Crux native indexer crates.
//!
//! This crate is intentionally data-only. It owns JSON ABI shapes for the
//! Rust worker boundary, but it does not parse source text, project facts, run
//! lint rules, or perform process I/O.

pub mod static_index;
pub mod static_syntax;
pub mod worker;

pub use static_syntax::*;
