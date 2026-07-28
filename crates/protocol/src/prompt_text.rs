//! Data-only contracts for transient PromptText analysis.
//!
//! These records cross the persistent native-worker boundary. They contain
//! normalized UTF-16 evidence only: parser ASTs, dirty facts, and cache state
//! must never enter this module.

use serde::{Deserialize, Serialize};

mod preview;
mod structure;

pub use preview::*;
pub use structure::*;

/// Persistent-worker method for one cache-bypassing PromptText query.
pub const PROMPT_TEXT_QUERY_METHOD: &str = "promptTextQuery";

/// JSON ABI version shared by Rust, Go, LSP, and the VS Code client.
pub const PROMPT_TEXT_PROTOCOL_VERSION: u16 = 1;

/// A zero-based UTF-16 position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextPosition {
    pub line: u32,
    pub character: u32,
}

/// A half-open range measured in zero-based UTF-16 positions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextRange {
    pub start: PromptTextPosition,
    pub end: PromptTextPosition,
}

/// A half-open UTF-16 code-unit range within one projected literal island.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextOffsetRange {
    pub start: u32,
    pub end: u32,
}

/// Exact editor-buffer revision analyzed by the transient compiler.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextDocumentRevision {
    pub open_epoch: u64,
    pub version: i64,
    pub source_hash: String,
}

/// Completeness of a whole request or one included template payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextAnalysisStatus {
    Complete,
    Truncated,
    Unsupported,
}

/// Centralized bounds applied by projection, classification, and serialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextLimits {
    pub max_source_bytes: u32,
    pub max_templates: u32,
    pub max_template_bytes: u32,
    pub max_traversal_nodes: u32,
    pub max_output_bytes: u32,
    pub max_string_refactors: u32,
    pub max_string_refactor_bytes: u32,
    pub max_string_refactor_output_bytes: u32,
    pub max_fragments: u32,
    pub max_fragment_joins: u32,
    pub max_fragment_bytes: u32,
    pub max_fragment_depth: u32,
    pub max_preview_bytes: u32,
}

/// One bounded, semantically proven fragment available to static analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextFragment {
    pub id: String,
    pub symbol: String,
    pub file: String,
    pub source_hash: String,
    pub range: PromptTextRange,
    pub snippet: String,
}

/// Strength of one externally supplied interpolation-to-fragment proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextEvidenceProof {
    SemanticExact,
}

/// Exact current-source occurrence receiving a proven fragment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextInterpolationJoinKey {
    pub file: String,
    pub source_hash: String,
    pub template_range: PromptTextRange,
    pub interpolation: u32,
    pub expression_range: PromptTextRange,
}

/// One semantic-exact edge from an interpolation to a supplied fragment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextFragmentJoin {
    pub key: PromptTextInterpolationJoinKey,
    pub fragment_id: String,
    pub proof: PromptTextEvidenceProof,
}

/// One cache-bypassing query over an exact open-document revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextQueryRequest {
    pub protocol_version: u16,
    pub file: String,
    pub language_id: String,
    pub revision: PromptTextDocumentRevision,
    pub source: String,
    pub fragments: Vec<PromptTextFragment>,
    pub fragment_joins: Vec<PromptTextFragmentJoin>,
    pub limits: PromptTextLimits,
}

/// Persistent-worker envelope for one PromptText query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextWorkerRequest {
    pub id: u64,
    pub method: String,
    pub query: PromptTextQueryRequest,
}

/// Strength of one compiler-owned ordinary-string conversion proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextRefactorProofLevel {
    SyntaxExact,
}

/// One exact ordinary-string replacement proven independently of template
/// classification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextRefactorProof {
    OrdinaryStringToMd {
        candidate_id: u32,
        range: PromptTextRange,
        expected_text: String,
        template_text: String,
        proof: PromptTextRefactorProofLevel,
    },
}

/// Independent completeness and source-order proofs for string refactors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextRefactorAnalysis {
    pub status: PromptTextAnalysisStatus,
    pub proofs: Vec<PromptTextRefactorProof>,
}

/// Normalized result for one exact request revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextQueryResponse {
    pub protocol_version: u16,
    pub file: String,
    pub revision: PromptTextDocumentRevision,
    pub status: PromptTextAnalysisStatus,
    pub templates: Vec<PromptTextTemplate>,
    pub refactors: PromptTextRefactorAnalysis,
}
