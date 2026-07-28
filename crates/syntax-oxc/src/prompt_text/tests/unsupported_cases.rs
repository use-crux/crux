use crux_indexer_protocol::prompt_text::PromptTextAnalysisStatus;

use super::{project, range, request};

#[test]
fn invalid_cooked_quasi_has_exact_backticks_and_no_raw_fallback() {
    let projected = project(&request("const value = md`\\u{110000}`;"));

    assert_eq!(projected.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(projected.templates.len(), 1);
    let projected = &projected.templates[0];
    assert!(projected.islands.is_empty());
    assert_eq!(
        projected.template.status,
        PromptTextAnalysisStatus::Unsupported
    );
    assert_eq!(
        projected.template.backtick_ranges,
        [range(0, 16, 0, 17), range(0, 27, 0, 28)]
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
