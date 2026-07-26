use crux_indexer_protocol::prompt_text::{
    PROMPT_TEXT_PROTOCOL_VERSION, PromptTextAnalysisStatus, PromptTextQueryRequest,
};
use oxc_allocator::Allocator;
use oxc_ast::AstKind;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType};

use super::{
    mapping::SourceMap,
    projection::{ProjectedPromptText, template},
};

/// Projects every bounded tagged template without assigning semantic identity.
pub fn project(request: &PromptTextQueryRequest) -> ProjectedPromptText {
    if request.protocol_version != PROMPT_TEXT_PROTOCOL_VERSION
        || !supported_language(&request.language_id)
        || request.source.len() > request.limits.max_source_bytes as usize
    {
        return unsupported();
    }

    let allocator = Allocator::default();
    let source_type = SourceType::from_path(&request.file)
        .unwrap_or_default()
        .with_module(true);
    let parsed = Parser::new(&allocator, &request.source, source_type).parse();
    if parsed.panicked {
        return unsupported();
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    if semantic.nodes().len() > request.limits.max_traversal_nodes as usize {
        return truncated();
    }
    let mut candidates = semantic
        .nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::TaggedTemplateExpression(tagged) => Some(tagged),
            _ => None,
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|tagged| tagged.span().start);
    candidates.dedup_by_key(|tagged| tagged.span());

    let limit = request.limits.max_templates as usize;
    let status = if candidates.len() > limit {
        PromptTextAnalysisStatus::Truncated
    } else {
        PromptTextAnalysisStatus::Complete
    };
    candidates.truncate(limit);
    let map = SourceMap::new(&request.source);
    let templates = candidates
        .into_iter()
        .enumerate()
        .map(|(index, tagged)| template(&request.source, &map, index as u32, tagged))
        .collect();
    ProjectedPromptText { status, templates }
}

fn supported_language(language: &str) -> bool {
    matches!(
        language,
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact"
    )
}

fn unsupported() -> ProjectedPromptText {
    ProjectedPromptText {
        status: PromptTextAnalysisStatus::Unsupported,
        templates: Vec::new(),
    }
}

fn truncated() -> ProjectedPromptText {
    ProjectedPromptText {
        status: PromptTextAnalysisStatus::Truncated,
        templates: Vec::new(),
    }
}
