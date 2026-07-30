use serde::{Deserialize, Serialize};

use super::PromptTextRange;

/// Provenance segment whose text participates in exact preview reconstruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextPreviewSegment {
    AuthoredLiteral {
        text: String,
        range: PromptTextRange,
    },
    KnownValue {
        text: String,
        interpolation: u32,
        interpolation_path: Vec<u32>,
    },
    Fragment {
        text: String,
        fragment_id: String,
        source_hash: String,
    },
    Placeholder {
        text: String,
        interpolation: u32,
        interpolation_path: Vec<u32>,
    },
}

/// Strongest proof that contributed bytes to one preview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextPreviewEvidence {
    SyntaxExact,
    SemanticExact,
}

/// Completeness of preview rendering, independent from template structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PromptTextPreviewStatus {
    Complete,
    Truncated,
    Unavailable,
}

/// Bounded condition that stopped preview rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptTextPreviewTruncationReason {
    MaxPreviewBytes,
    MaxFragmentDepth,
}

/// Metadata-only description of the first deterministic preview truncation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextPreviewTruncation {
    pub reason: PromptTextPreviewTruncationReason,
    pub limit: u32,
    pub emitted_bytes: u32,
}

/// Static preview bytes and the ordered segments that reconstruct them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextPreview {
    pub status: PromptTextPreviewStatus,
    pub evidence: Option<PromptTextPreviewEvidence>,
    pub text: String,
    pub segments: Vec<PromptTextPreviewSegment>,
    pub truncation: Option<PromptTextPreviewTruncation>,
}

impl Default for PromptTextPreview {
    fn default() -> Self {
        Self {
            status: PromptTextPreviewStatus::Unavailable,
            evidence: None,
            text: String::new(),
            segments: Vec::new(),
            truncation: None,
        }
    }
}
