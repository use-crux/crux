use serde::{Deserialize, Serialize};

use super::{PromptTextAnalysisStatus, PromptTextOffsetRange, PromptTextPreview, PromptTextRange};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextLiteralIsland {
    pub index: u32,
    pub range: PromptTextRange,
    pub projection_length: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextInterpolationBarrier {
    pub index: u32,
    pub range: PromptTextRange,
    pub expression_range: PromptTextRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    rename_all_fields = "camelCase"
)]
pub enum PromptTextBlock {
    Heading {
        index: u32,
        island: u32,
        level: u8,
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

/// One normalized inline CommonMark span with exact authored ranges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
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
    rename_all_fields = "camelCase"
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
    rename_all_fields = "camelCase"
)]
pub enum PromptTextNodeRef {
    Block { index: u32 },
    Span { index: u32 },
    Link { index: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextNesting {
    pub parent: PromptTextNodeRef,
    pub child: PromptTextNodeRef,
    pub ordinal: u32,
}

/// One tag-neutral template projection and its normalized Markdown payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextTemplate {
    pub candidate_id: u32,
    pub range: PromptTextRange,
    pub tag_range: PromptTextRange,
    pub template_range: PromptTextRange,
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
