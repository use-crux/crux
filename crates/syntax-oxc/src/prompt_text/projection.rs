use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextLiteralIsland, PromptTextPreview, PromptTextTemplate,
};
use oxc_ast::ast::TaggedTemplateExpression;
use oxc_span::{GetSpan, Span};

use super::{
    cooked,
    interpolation::barriers,
    mapping::{ByteMapping, SourceMap, protocol_mappings},
    normalization,
};

/// One literal slice retained privately for the Markdown classifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedTextIsland {
    /// Stable zero-based island identity within the containing template.
    pub index: u32,
    /// Core-normalized ECMAScript-cooked text between template barriers.
    pub text: String,
    /// Exact authored quasi extent before cooking and whitespace normalization.
    pub(crate) source_range: std::ops::Range<usize>,
    /// Ordered compiler-private byte mappings used by the classifier.
    pub(crate) mappings: Vec<ByteMapping>,
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
    let quasis = tagged.quasi.quasis.iter().collect::<Vec<_>>();
    let quasi_spans = quasis
        .iter()
        .map(|quasi| quasi.span())
        .collect::<Vec<Span>>();
    let cooked = quasis
        .iter()
        .enumerate()
        .map(|(index, quasi)| cooked::island(source, index as u32, quasi))
        .collect::<Option<Vec<_>>>();
    let Some(islands) = cooked.and_then(normalization::normalize) else {
        return unsupported(map, candidate_id, tagged);
    };
    let literal_islands = islands
        .iter()
        .map(|island| PromptTextLiteralIsland {
            index: island.index,
            range: map.bytes(island.source_range.clone()),
            projection_length: island.text.encode_utf16().count() as u32,
        })
        .collect::<Vec<_>>();
    let mappings = islands
        .iter()
        .flat_map(|island| protocol_mappings(source, island))
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

fn unsupported(
    map: &SourceMap<'_>,
    candidate_id: u32,
    tagged: &TaggedTemplateExpression<'_>,
) -> ProjectedPromptTextTemplate {
    ProjectedPromptTextTemplate {
        template: PromptTextTemplate {
            candidate_id,
            range: map.span(tagged.span()),
            tag_range: map.span(tagged.tag.span()),
            template_range: map.span(tagged.quasi.span()),
            status: PromptTextAnalysisStatus::Unsupported,
            literal_islands: Vec::new(),
            interpolation_barriers: Vec::new(),
            mappings: Vec::new(),
            blocks: Vec::new(),
            spans: Vec::new(),
            links: Vec::new(),
            nesting: Vec::new(),
            preview: PromptTextPreview::default(),
        },
        islands: Vec::new(),
    }
}
