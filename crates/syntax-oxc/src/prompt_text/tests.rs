use crux_indexer_protocol::prompt_text::{
    PROMPT_TEXT_PROTOCOL_VERSION, PromptTextAnalysisStatus, PromptTextDocumentRevision,
    PromptTextLimits, PromptTextOffsetRange, PromptTextPosition, PromptTextQueryRequest,
    PromptTextRange, PromptTextSourceMapping,
};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

use super::project;

mod projection_boundaries;

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
fn prompt_text_projection_uses_cooked_core_normalization_and_segmented_mappings() {
    let source = concat!(
        "const name = 'Ada'; const value = local.md`\r\n",
        "    # Caf\\u{e9} 😀\r\n",
        "    **bold** ${/* opaque */ name}\r\n",
        "`;"
    );
    let projected = project(&request(source));

    assert_eq!(projected.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(projected.templates.len(), 1);
    let projected = &projected.templates[0];
    assert_eq!(projected.islands[0].text, "# Café 😀\n**bold** ");
    assert!(projected.islands[1].text.is_empty());
    assert_eq!(
        projected
            .template
            .literal_islands
            .iter()
            .map(|island| island.projection_length)
            .collect::<Vec<_>>(),
        vec![19, 0]
    );
    assert_eq!(
        projected.template.mappings,
        vec![
            mapping(0, 0, 5, range(1, 4, 1, 9)),
            mapping(0, 5, 6, range(1, 9, 1, 15)),
            mapping(0, 6, 9, range(1, 15, 1, 18)),
            mapping(0, 9, 10, range(1, 18, 2, 0)),
            mapping(0, 10, 19, range(2, 4, 2, 13)),
        ]
    );
    assert_eq!(projected.template.interpolation_barriers.len(), 1);
    assert_eq!(
        projected.template.interpolation_barriers[0].range.start,
        PromptTextPosition {
            line: 2,
            character: 13,
        }
    );
}

#[test]
fn prompt_text_projection_rejects_an_invalid_cooked_quasi_without_raw_fallback() {
    let projected = project(&request("const value = md`\\u{110000}`;"));

    assert_eq!(projected.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(projected.templates.len(), 1);
    let projected = &projected.templates[0];
    assert!(projected.islands.is_empty());
    assert_eq!(
        projected.template.status,
        PromptTextAnalysisStatus::Unsupported
    );
    assert!(projected.template.literal_islands.is_empty());
    assert!(projected.template.interpolation_barriers.is_empty());
    assert!(projected.template.mappings.is_empty());
    assert!(projected.template.blocks.is_empty());
    assert!(projected.template.spans.is_empty());
    assert!(projected.template.links.is_empty());
    assert!(projected.template.nesting.is_empty());
    assert!(projected.template.preview.text.is_empty());
    assert!(projected.template.preview.segments.is_empty());
}

#[test]
fn prompt_text_projection_uses_oxc_cooked_values_for_template_escape_forms() {
    let cases = [
        ("\\`", "a`z"),
        ("\\${", "a${z"),
        ("\\\\", "a\\z"),
        ("\\'", "a'z"),
        ("\\\"", "a\"z"),
        ("\\b", "a\u{0008}z"),
        ("\\f", "a\u{000c}z"),
        ("\\n", "a\nz"),
        ("\\r", "a\rz"),
        ("\\t", "a\tz"),
        ("\\v", "a\u{000b}z"),
        ("\\0", "a\0z"),
        ("\\x23", "a#z"),
        ("\\u0023", "a#z"),
        ("\\u{1F600}", "a😀z"),
        ("\\uD83D\\uDE00", "a😀z"),
        ("\\q", "aqz"),
        ("\\\n", "az"),
        ("\\\r\n", "az"),
        ("\\\r", "az"),
        ("\\\u{2028}", "az"),
        ("\\\u{2029}", "az"),
        ("\r\n", "a\nz"),
        ("\r", "a\nz"),
    ];

    for (authored, expected) in cases {
        let source = format!("const value = md`a{authored}z`;");
        let projected = project(&request(&source));
        let template = &projected.templates[0];
        assert_eq!(
            template.template.status,
            PromptTextAnalysisStatus::Complete,
            "authored escape {authored:?}"
        );
        assert_eq!(
            template.islands[0].text, expected,
            "authored escape {authored:?}"
        );
        assert_eq!(
            template.template.literal_islands[0].projection_length,
            expected.encode_utf16().count() as u32,
            "authored escape {authored:?}"
        );
        assert_mapping_partition(template, expected, authored);
    }
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

fn assert_mapping_partition(
    projected: &super::ProjectedPromptTextTemplate,
    expected: &str,
    authored: &str,
) {
    let mappings = projected
        .template
        .mappings
        .iter()
        .filter(|mapping| mapping.island == 0)
        .collect::<Vec<_>>();
    assert!(!mappings.is_empty(), "authored escape {authored:?}");
    assert_eq!(
        mappings.first().expect("mapping").projection_range.start,
        0,
        "authored escape {authored:?}"
    );
    assert_eq!(
        mappings.last().expect("mapping").projection_range.end,
        expected.encode_utf16().count() as u32,
        "authored escape {authored:?}"
    );
    for pair in mappings.windows(2) {
        assert_eq!(
            pair[0].projection_range.end, pair[1].projection_range.start,
            "authored escape {authored:?}"
        );
    }
}

fn mapping(
    island: u32,
    start: u32,
    end: u32,
    source_range: PromptTextRange,
) -> PromptTextSourceMapping {
    PromptTextSourceMapping {
        island,
        projection_range: PromptTextOffsetRange { start, end },
        source_range,
    }
}

fn range(
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
) -> PromptTextRange {
    PromptTextRange {
        start: PromptTextPosition {
            line: start_line,
            character: start_character,
        },
        end: PromptTextPosition {
            line: end_line,
            character: end_character,
        },
    }
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
