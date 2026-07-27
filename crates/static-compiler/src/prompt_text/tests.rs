use crux_indexer_protocol::prompt_text::{
    PROMPT_TEXT_PROTOCOL_VERSION, PromptTextAnalysisStatus, PromptTextBlock,
    PromptTextDocumentRevision, PromptTextLimits, PromptTextPosition, PromptTextQueryRequest,
    PromptTextRange,
};

use super::analyze;

mod barrier_cases;
mod folding_cases;
mod heading_label_cases;
mod link_cases;
mod structure_cases;
mod support;
mod surrogate_cases;

#[test]
fn prompt_text_heading_preserves_construct_and_text_ranges() {
    let response = analyze(request("const value = md`# Hello`;"));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(response.templates.len(), 1);
    assert_eq!(
        response.templates[0].blocks,
        vec![PromptTextBlock::Heading {
            index: 0,
            island: 0,
            level: 1,
            label: "Hello".into(),
            range: range(0, 17, 0, 24),
            text_range: range(0, 19, 0, 24),
        }]
    );
}

#[test]
fn prompt_text_output_limit_counts_only_compact_complete_template_objects() {
    let source = "const value = md`# \"Hello\"`;";
    let unbounded = analyze(request(source));
    assert!(matches!(
        &unbounded.templates[0].blocks[0],
        PromptTextBlock::Heading { label, .. } if label == "\"Hello\""
    ));
    let template_bytes = serde_json::to_vec(&unbounded.templates[0])
        .expect("PromptText template should serialize")
        .len();

    let mut exact = request(source);
    exact.limits.max_output_bytes =
        u32::try_from(template_bytes).expect("fixture should fit the protocol limit");
    let exact_response = analyze(exact);

    assert_eq!(exact_response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(exact_response.templates.len(), 1);
    assert!(
        serde_json::to_vec(&exact_response)
            .expect("PromptText response should serialize")
            .len()
            > template_bytes,
        "the response envelope must not count toward maxOutputBytes"
    );

    let mut overflow = request(source);
    overflow.limits.max_output_bytes =
        u32::try_from(template_bytes - 1).expect("fixture should fit the protocol limit");
    let overflow_response = analyze(overflow);

    assert_eq!(
        overflow_response.status,
        PromptTextAnalysisStatus::Truncated
    );
    assert!(overflow_response.templates.is_empty());
}

#[test]
fn prompt_text_output_limit_retains_the_longest_source_order_prefix() {
    let source = "const first = md`# One`;\nconst second = md`## Two`;";
    let unbounded = analyze(request(source));
    assert_eq!(unbounded.templates.len(), 2);

    let first = unbounded.templates[0].clone();
    let mut limited = request(source);
    limited.limits.max_output_bytes = u32::try_from(
        serde_json::to_vec(&first)
            .expect("PromptText template should serialize")
            .len(),
    )
    .expect("fixture should fit the protocol limit");

    let response = analyze(limited);

    assert_eq!(response.status, PromptTextAnalysisStatus::Truncated);
    assert_eq!(response.templates, vec![first]);
}

#[test]
fn prompt_text_output_limit_counts_label_json_and_template_comma_exactly() {
    let source = "const first = md`# \"One\"`;\nconst second = md`## Two`;";
    let unbounded = analyze(request(source));
    assert_eq!(unbounded.templates.len(), 2);
    let exact_bytes = unbounded
        .templates
        .iter()
        .map(|template| {
            serde_json::to_vec(template)
                .expect("PromptText template should serialize")
                .len()
        })
        .sum::<usize>()
        + 1;

    let mut exact = request(source);
    exact.limits.max_output_bytes =
        u32::try_from(exact_bytes).expect("fixture should fit the protocol limit");
    let exact_response = analyze(exact);
    assert_eq!(exact_response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(exact_response.templates.len(), 2);

    let mut one_byte_under = request(source);
    one_byte_under.limits.max_output_bytes =
        u32::try_from(exact_bytes - 1).expect("fixture should fit the protocol limit");
    let truncated = analyze(one_byte_under);
    assert_eq!(truncated.status, PromptTextAnalysisStatus::Truncated);
    assert_eq!(truncated.templates.len(), 1);
}

#[test]
fn prompt_text_zero_output_limit_permits_only_an_empty_payload() {
    let mut with_template = request("const value = md`# Hello`;");
    with_template.limits.max_output_bytes = 0;
    let truncated = analyze(with_template);

    assert_eq!(truncated.status, PromptTextAnalysisStatus::Truncated);
    assert!(truncated.templates.is_empty());

    let mut without_templates = request("const value = 1;");
    without_templates.limits.max_output_bytes = 0;
    let complete = analyze(without_templates);

    assert_eq!(complete.status, PromptTextAnalysisStatus::Complete);
    assert!(complete.templates.is_empty());
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
