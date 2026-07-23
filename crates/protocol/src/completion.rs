//! Data-only request and response shapes for transient compiler completion.
//!
//! These values cross the persistent native-worker boundary. They are not
//! Project Index facts and must never be written to an index cache or patch.

use serde::{Deserialize, Serialize};

/// Method string for a transient completion query on the persistent worker.
pub const COMPLETION_QUERY_METHOD: &str = "completionQuery";

/// A zero-based UTF-16 source position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPosition {
    pub line: u32,
    pub character: u32,
}

/// A half-open UTF-16 source range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRange {
    pub start: CompletionPosition,
    pub end: CompletionPosition,
}

/// Compact Project Definition data admitted to a completion query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionCandidate {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub binding: String,
    pub file: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub character: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// One additional eager source edit computed from the same unsaved parse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionTextEdit {
    pub range: CompletionRange,
    pub new_text: String,
}

/// One cache-bypassing completion query over an unsaved document snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionQueryRequest {
    pub file: String,
    pub language_id: String,
    pub source: String,
    pub position: CompletionPosition,
    pub candidates: Vec<CompletionCandidate>,
    pub limit: usize,
}

/// One eager edit recipe produced by the compiler.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionQueryItem {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub detail: String,
    pub insert_text: String,
    pub replacement: CompletionRange,
    #[serde(default)]
    pub additional_text_edits: Vec<CompletionTextEdit>,
}

/// Deterministic result from one transient compiler query.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionQueryResponse {
    pub is_incomplete: bool,
    pub items: Vec<CompletionQueryItem>,
}

/// Persistent-worker envelope for one completion query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionWorkerRequest {
    pub id: u64,
    pub method: String,
    pub query: CompletionQueryRequest,
}
