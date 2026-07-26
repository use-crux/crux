use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextLiteralIsland, PromptTextOffsetRange, PromptTextPreview,
    PromptTextSourceMapping, PromptTextTemplate,
};
use oxc_ast::ast::TaggedTemplateExpression;
use oxc_span::{GetSpan, Span};

use super::{interpolation::barriers, mapping::SourceMap};

/// One literal slice retained privately for the Markdown classifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedTextIsland {
    /// Stable zero-based island identity within the containing template.
    pub index: u32,
    /// Exact authored literal bytes between template barriers.
    pub text: String,
    /// UTF-8 byte offset of `text` within the complete source document.
    pub source_start: usize,
}

/// One wire candidate plus its classifier-only literal text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedPromptTextTemplate {
    /// AST-free wire projection shared with Go.
    pub template: PromptTextTemplate,
    /// Compiler-private source used only by the Rust Markdown classifier.
    pub islands: Vec<ProjectedTextIsland>,
}

/// Tag-neutral result before Markdown classification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedPromptText {
    /// Request-wide completeness after whole-candidate limits.
    pub status: PromptTextAnalysisStatus,
    /// Included candidates in authored source order.
    pub templates: Vec<ProjectedPromptTextTemplate>,
}

pub(crate) fn template(
    source: &str,
    map: &SourceMap<'_>,
    candidate_id: u32,
    tagged: &TaggedTemplateExpression<'_>,
) -> ProjectedPromptTextTemplate {
    let quasi_spans = tagged
        .quasi
        .quasis
        .iter()
        .map(GetSpan::span)
        .collect::<Vec<Span>>();
    let islands = quasi_spans
        .iter()
        .enumerate()
        .map(|(index, span)| ProjectedTextIsland {
            index: index as u32,
            text: source[span.start as usize..span.end as usize].to_string(),
            source_start: span.start as usize,
        })
        .collect::<Vec<_>>();
    let literal_islands = islands
        .iter()
        .zip(&quasi_spans)
        .map(|(island, span)| PromptTextLiteralIsland {
            index: island.index,
            range: map.span(*span),
            projection_length: island.text.encode_utf16().count() as u32,
        })
        .collect::<Vec<_>>();
    let mappings = literal_islands
        .iter()
        .map(|island| PromptTextSourceMapping {
            island: island.index,
            projection_range: PromptTextOffsetRange {
                start: 0,
                end: island.projection_length,
            },
            source_range: island.range,
        })
        .collect();

    ProjectedPromptTextTemplate {
        template: PromptTextTemplate {
            candidate_id,
            range: map.span(tagged.span()),
            tag_range: map.span(tagged.tag.span()),
            template_range: map.span(tagged.quasi.span()),
            status: PromptTextAnalysisStatus::Complete,
            literal_islands,
            interpolation_barriers: barriers(map, &quasi_spans, &tagged.quasi.expressions),
            mappings,
            blocks: Vec::new(),
            spans: Vec::new(),
            links: Vec::new(),
            nesting: Vec::new(),
            preview: PromptTextPreview::default(),
        },
        islands,
    }
}
