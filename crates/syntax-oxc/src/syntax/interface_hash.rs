//! Exported-source surface hashing for incremental invalidation.
//!
//! This mirrors `packages/indexer/indexer/source-interface-hash.ts`: function
//! bodies are reduced to signatures, while exported variable initializers and
//! declarations remain conservative source-surface evidence.

mod exports;
mod rows;
mod signatures;
mod text;

use oxc_ast::ast::Program;
use serde_json::to_string;
use sha2::{Digest, Sha256};

pub(crate) fn source_interface_hash_from_program(program: &Program<'_>, source: &str) -> String {
    let rows = rows::exported_interface_rows(program, source);
    sha256(&to_string(&rows).unwrap_or_else(|_| "[]".to_string()))
}

fn sha256(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}
