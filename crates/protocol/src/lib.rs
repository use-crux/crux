//! Wire protocol types shared by Crux native indexer crates.
//!
//! This crate is intentionally data-only. It owns JSON ABI shapes for the
//! Rust worker boundary, but it does not parse source text, project facts, run
//! lint rules, or perform process I/O.

pub mod completion;
pub mod process;
pub mod project_index_events;
pub mod prompt_text;
pub mod static_index;
pub mod static_syntax;

pub use static_syntax::*;

#[cfg(test)]
mod prompt_text_tests;
#[cfg(test)]
mod static_syntax_tests;
