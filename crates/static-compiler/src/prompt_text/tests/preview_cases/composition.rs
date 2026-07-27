use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextPreviewStatus, PromptTextPreviewTruncationReason,
};

use super::super::{analyze, request};

#[test]
fn preview_matches_core_block_indentation_and_earliest_longest_seams() {
    let source = concat!(
        "const multiline = md`",
        "\n  value:",
        "\n    ${\"a\\nb\"}",
        "\n`;\n",
        "const middle = md`",
        "\n  before",
        "\n  ${undefined}",
        "\n  after",
        "\n`;\n",
        "const larger = md`",
        "\n  before",
        "\n",
        "\n",
        "\n  ${undefined}",
        "\n",
        "\n  after",
        "\n`;\n",
        "const tie = md`",
        "\n    before",
        "\n    ",
        "\n    ${undefined}",
        "\n\t",
        "\n    after",
        "\n`;\n",
    );
    let previews = analyze(request(source))
        .templates
        .into_iter()
        .map(|template| template.preview.text)
        .collect::<Vec<_>>();

    assert_eq!(
        previews,
        vec![
            "value:\n  a\n  b",
            "before\nafter",
            "before\n\n\nafter",
            "before\n\nafter",
        ],
    );
}

#[test]
fn preview_byte_limit_retains_whole_segments_without_degrading_structure() {
    let source = "const value = md`# é${\"x\"}z`;";
    let mut exact = request(source);
    exact.limits.max_preview_bytes = 6;
    let exact = analyze(exact);
    assert_eq!(exact.templates[0].preview.text, "# éxz");
    assert_eq!(
        exact.templates[0].preview.status,
        PromptTextPreviewStatus::Complete
    );

    let mut truncated = request(source);
    truncated.limits.max_preview_bytes = 5;
    let truncated = analyze(truncated);
    let template = &truncated.templates[0];
    assert_eq!(template.status, PromptTextAnalysisStatus::Complete);
    assert!(
        !template.blocks.is_empty(),
        "preview limits must retain structure"
    );
    assert_eq!(template.preview.status, PromptTextPreviewStatus::Truncated);
    assert_eq!(template.preview.text, "# éx");
    assert_eq!(
        template.preview.truncation.as_ref().map(|value| (
            value.reason,
            value.limit,
            value.emitted_bytes
        )),
        Some((PromptTextPreviewTruncationReason::MaxPreviewBytes, 5, 5)),
    );

    let mut zero = request(source);
    zero.limits.max_preview_bytes = 0;
    let zero = analyze(zero);
    assert_eq!(zero.templates[0].preview.text, "");
    assert!(zero.templates[0].preview.segments.is_empty());
    assert_eq!(
        zero.templates[0]
            .preview
            .truncation
            .as_ref()
            .map(|value| value.emitted_bytes),
        Some(0),
    );
}

#[test]
fn preview_distinguishes_fragment_cycles_from_depth_truncation() {
    let source = concat!(
        "const cyclic = md`start ${cyclic} later`;\n",
        "const leaf = md`leaf`;\n",
        "const one = md`${leaf}`;\n",
        "const root = md`before ${one} after`;\n",
    );

    let complete = analyze(request(source));
    assert_eq!(complete.templates[0].preview.text, "start ⟪unknown⟫ later");
    assert_eq!(
        complete.templates[0].preview.status,
        PromptTextPreviewStatus::Complete
    );
    assert_eq!(complete.templates[3].preview.text, "before leaf after");

    let mut limited = request(source);
    limited.limits.max_fragment_depth = 1;
    let limited = analyze(limited);
    let preview = &limited.templates[3].preview;
    assert_eq!(preview.status, PromptTextPreviewStatus::Truncated);
    assert_eq!(preview.text, "before ");
    assert_eq!(
        preview
            .truncation
            .as_ref()
            .map(|value| (value.reason, value.limit, value.emitted_bytes)),
        Some((PromptTextPreviewTruncationReason::MaxFragmentDepth, 1, 7,)),
    );
}

#[test]
fn preview_bounds_repeated_fragment_materialization_during_composition() {
    let mut source = String::from("const fragment0 = md`x`;\n");
    for depth in 1..=20 {
        source.push_str(&format!(
            "const fragment{depth} = md`${{fragment{previous}}}${{fragment{previous}}}`;\n",
            previous = depth - 1,
        ));
    }
    let mut bounded = request(&source);
    bounded.limits.max_preview_bytes = 1;
    bounded.limits.max_fragment_depth = 20;

    let response = analyze(bounded);
    let preview = &response.templates.last().expect("root fragment").preview;

    assert_eq!(preview.status, PromptTextPreviewStatus::Truncated);
    assert_eq!(preview.text, "");
    assert_eq!(
        preview
            .truncation
            .as_ref()
            .map(|value| (value.reason, value.limit, value.emitted_bytes)),
        Some((PromptTextPreviewTruncationReason::MaxPreviewBytes, 1, 0)),
    );
}

#[test]
fn preview_memoizes_zero_output_fragment_dags() {
    const FANOUT: usize = 8;
    const DEPTH: usize = 12;

    let mut source = String::from("const fragment0 = md``;\n");
    for depth in 1..=DEPTH {
        let references = format!("${{fragment{}}}", depth - 1).repeat(FANOUT);
        source.push_str(&format!("const fragment{depth} = md`{references}`;\n"));
    }
    let mut bounded = request(&source);
    bounded.limits.max_fragment_depth = DEPTH as u32;

    let response = analyze(bounded);
    let preview = &response.templates.last().expect("root fragment").preview;

    assert_eq!(preview.status, PromptTextPreviewStatus::Complete);
    assert_eq!(preview.text, "");
    assert!(preview.segments.is_empty());
}

#[test]
fn preview_applies_fragment_provenance_before_whole_segment_bounding() {
    let source = concat!(
        "const inner = md`${\"a\"}${\"b\"}`;\n",
        "const root = md`${inner}`;\n",
    );
    let mut bounded = request(source);
    bounded.limits.max_preview_bytes = 1;

    let response = analyze(bounded);
    assert_eq!(response.templates[0].preview.text, "a");
    let root = &response.templates[1].preview;
    assert_eq!(root.text, "");
    assert!(root.segments.is_empty());
    assert_eq!(
        root.truncation
            .as_ref()
            .map(|value| (value.reason, value.limit, value.emitted_bytes)),
        Some((PromptTextPreviewTruncationReason::MaxPreviewBytes, 1, 0)),
    );
}

#[test]
fn preview_bounds_one_fragment_provenance_run_across_lines() {
    let source = concat!(
        "const inner = md`a\nb`;\n",
        "const root = md`${inner}`;\n",
        "const prefixed = md`x${inner}`;\n",
    );
    let mut bounded = request(source);
    bounded.limits.max_preview_bytes = 1;

    let response = analyze(bounded);
    assert_eq!(response.templates[0].preview.text, "a");
    let root = &response.templates[1].preview;
    assert_eq!(root.text, "");
    assert!(root.segments.is_empty());
    assert_eq!(
        root.truncation.as_ref().map(|value| value.emitted_bytes),
        Some(0),
    );

    let mut prefixed = request(source);
    prefixed.limits.max_preview_bytes = 3;
    let prefixed = analyze(prefixed);
    assert_eq!(prefixed.templates[2].preview.text, "x");
}
