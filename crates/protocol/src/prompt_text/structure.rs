use serde::{Deserialize, Serialize};

use super::{PromptTextAnalysisStatus, PromptTextOffsetRange, PromptTextPreview, PromptTextRange};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextLiteralIsland {
    pub index: u32,
    pub range: PromptTextRange,
    pub projection_length: u32,
}

/// One Rust-proven source replacement that makes a barrier block-positioned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextLineIsolationEdit {
    /// Half-open UTF-16 source range replaced by the edit.
    pub range: PromptTextRange,
    /// Exact authored source text currently occupying `range`.
    pub expected_text: String,
    /// Exact replacement text, including compiler-selected line endings.
    pub new_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextInterpolationBarrier {
    pub index: u32,
    pub range: PromptTextRange,
    pub expression_range: PromptTextRange,
    /// Optional counterfactual proof; production omits unavailable evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_isolation_edit: Option<PromptTextLineIsolationEdit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextSourceMapping {
    pub island: u32,
    pub projection_range: PromptTextOffsetRange,
    pub source_range: PromptTextRange,
}

/// One normalized CommonMark block; parser-specific types remain private.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextBlock {
    Heading {
        index: u32,
        island: u32,
        level: u8,
        #[serde(
            serialize_with = "serialize_nonempty_heading_label",
            deserialize_with = "deserialize_nonempty_heading_label"
        )]
        label: String,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    Paragraph {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    Blockquote {
        index: u32,
        island: u32,
        range: PromptTextRange,
        marker_ranges: Vec<PromptTextRange>,
    },
    List {
        index: u32,
        island: u32,
        range: PromptTextRange,
        ordered: bool,
        start: Option<u64>,
    },
    ListItem {
        index: u32,
        island: u32,
        range: PromptTextRange,
        marker_range: PromptTextRange,
    },
    CodeBlock {
        index: u32,
        island: u32,
        range: PromptTextRange,
        content_range: PromptTextRange,
        fenced: bool,
        info: Option<String>,
    },
    ThematicBreak {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    Html {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
}

fn serialize_nonempty_heading_label<S>(label: &String, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    if label.is_empty() {
        return Err(serde::ser::Error::custom(
            "PromptText heading label must be nonempty",
        ));
    }
    label.serialize(serializer)
}

fn deserialize_nonempty_heading_label<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let label = String::deserialize(deserializer)?;
    if label.is_empty() {
        return Err(serde::de::Error::custom(
            "PromptText heading label must be nonempty",
        ));
    }
    Ok(label)
}

/// One normalized inline CommonMark span with exact authored ranges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextSpan {
    Emphasis {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    Strong {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    InlineCode {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
    },
    Html {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    SoftBreak {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
    HardBreak {
        index: u32,
        island: u32,
        range: PromptTextRange,
    },
}

/// One parser-confirmed literal link. Go remains the destination trust owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextLink {
    Inline {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
        destination_range: PromptTextRange,
        destination: String,
        title: Option<String>,
    },
    Autolink {
        index: u32,
        island: u32,
        range: PromptTextRange,
        text_range: PromptTextRange,
        destination: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PromptTextNodeRef {
    Block { index: u32 },
    Span { index: u32 },
    Link { index: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextNesting {
    pub parent: PromptTextNodeRef,
    pub child: PromptTextNodeRef,
    pub ordinal: u32,
}

/// One tag-neutral template projection and its normalized Markdown payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTextTemplate {
    pub candidate_id: u32,
    pub range: PromptTextRange,
    pub tag_range: PromptTextRange,
    pub template_range: PromptTextRange,
    /// Exact opening and closing one-code-unit backtick ranges.
    pub backtick_ranges: [PromptTextRange; 2],
    pub status: PromptTextAnalysisStatus,
    pub literal_islands: Vec<PromptTextLiteralIsland>,
    pub interpolation_barriers: Vec<PromptTextInterpolationBarrier>,
    pub mappings: Vec<PromptTextSourceMapping>,
    pub blocks: Vec<PromptTextBlock>,
    pub spans: Vec<PromptTextSpan>,
    pub links: Vec<PromptTextLink>,
    pub nesting: Vec<PromptTextNesting>,
    pub preview: PromptTextPreview,
}
