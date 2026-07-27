use crux_indexer_protocol::prompt_text::{PromptTextPreviewSegment, PromptTextRange};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FragmentReference {
    Document(u32),
    Semantic(u32),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct RenderFlags {
    pub(super) truncation: Option<RenderTruncation>,
    pub(super) semantic_exact: bool,
    pub(super) cycle_sensitive: bool,
}

impl RenderFlags {
    pub(super) fn merge(&mut self, other: Self) {
        if self.truncation.is_none() {
            self.truncation = other.truncation;
        }
        self.semantic_exact |= other.semantic_exact;
        self.cycle_sensitive |= other.cycle_sensitive;
    }

    pub(super) fn is_truncated(self) -> bool {
        self.truncation.is_some()
    }

    pub(super) fn mark_byte_truncated(&mut self) {
        self.truncation = Some(RenderTruncation::MaxPreviewBytes);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RenderTruncation {
    MaxPreviewBytes,
    MaxFragmentDepth,
}

pub(super) enum FragmentOutcome {
    Segments(Vec<PromptTextPreviewSegment>, RenderFlags),
    Placeholder(RenderFlags),
    Truncated(Vec<PromptTextPreviewSegment>, RenderFlags),
}

pub(super) enum Placement {
    Inline,
    Block {
        indent: String,
        indent_range: Option<PromptTextRange>,
    },
}
