use serde::{Deserialize, Serialize};

use super::PromptTextRange;

/// Provenance segment whose text participates in exact preview reconstruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PromptTextPreviewSegment {
    AuthoredLiteral {
        text: String,
        range: PromptTextRange,
    },
    KnownValue {
        text: String,
        interpolation: u32,
    },
    Fragment {
        text: String,
        fragment_id: String,
        source_hash: String,
    },
    Placeholder {
        text: String,
        interpolation: u32,
    },
    Truncation {
        text: String,
    },
}

/// Static preview bytes and the ordered segments that reconstruct them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextPreview {
    pub text: String,
    pub segments: Vec<PromptTextPreviewSegment>,
}
