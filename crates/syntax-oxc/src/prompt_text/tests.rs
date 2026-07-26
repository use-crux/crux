use crux_indexer_protocol::prompt_text::{
    PROMPT_TEXT_PROTOCOL_VERSION, PromptTextAnalysisStatus, PromptTextDocumentRevision,
    PromptTextLimits, PromptTextQueryRequest,
};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

use super::project;

#[test]
fn prompt_text_projection_is_tag_neutral_and_utf16_mapped() {
    let source = "const face = '😀'; const value = local.md`# Hello`;";
    let projected = project(&request(source));

    assert_eq!(projected.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(projected.templates.len(), 1);
    let template = &projected.templates[0];
    assert_eq!(template.islands[0].text, "# Hello");
    let tagged_start = source.find("local.md").expect("tag should exist");
    let tagged_end = source.rfind('`').expect("closing backtick should exist") + 1;
    assert_eq!(
        template.template.range.start.character,
        source[..tagged_start].encode_utf16().count() as u32
    );
    assert_eq!(
        template.template.range.end.character,
        source[..tagged_end].encode_utf16().count() as u32
    );
}

#[test]
fn prompt_text_traversal_limit_counts_the_exact_semantic_table() {
    let source = "const first = md`# First`; const second = md`# Second`;";
    let semantic_nodes = semantic_node_count(source);
    let mut exact = request(source);
    exact.limits.max_traversal_nodes =
        u32::try_from(semantic_nodes).expect("fixture semantic table should fit u32");

    let projected = project(&exact);

    assert_eq!(projected.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(projected.templates.len(), 2);

    let mut overflow = exact;
    overflow.limits.max_traversal_nodes -= 1;
    let projected = project(&overflow);
    assert_eq!(projected.status, PromptTextAnalysisStatus::Truncated);
    assert!(projected.templates.is_empty());

    let mut zero = request(source);
    zero.limits.max_traversal_nodes = 0;
    let projected = project(&zero);
    assert_eq!(projected.status, PromptTextAnalysisStatus::Truncated);
    assert!(projected.templates.is_empty());
}

fn semantic_node_count(source: &str) -> usize {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path("/repo/src/writer.ts")
        .unwrap_or_default()
        .with_module(true);
    let parsed = Parser::new(&allocator, source, source_type).parse();
    SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic
        .nodes()
        .len()
}

fn request(source: &str) -> PromptTextQueryRequest {
    PromptTextQueryRequest {
        protocol_version: PROMPT_TEXT_PROTOCOL_VERSION,
        file: "/repo/src/writer.ts".into(),
        language_id: "typescript".into(),
        revision: PromptTextDocumentRevision {
            open_epoch: 1,
            version: 1,
            source_hash: "hash".into(),
        },
        source: source.into(),
        fragments: Vec::new(),
        limits: PromptTextLimits {
            max_source_bytes: 2 << 20,
            max_templates: 256,
            max_template_bytes: 256 << 10,
            max_traversal_nodes: 100_000,
            max_output_bytes: 1 << 20,
            max_fragments: 256,
            max_fragment_bytes: 64 << 10,
            max_fragment_depth: 16,
            max_preview_bytes: 1 << 20,
        },
    }
}
