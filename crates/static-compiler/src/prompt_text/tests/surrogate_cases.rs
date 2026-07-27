use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextBlock, PromptTextOffsetRange, PromptTextPosition,
    PromptTextRange,
};

use super::{analyze, request};

#[test]
fn prompt_text_surrogates_fail_closed_per_template_without_replacing_real_unicode() {
    let source = concat!(
        "const unsupported = md`# \\uD800`;\n",
        "const pair = md`# \\uD83D\\u{DE00}`;\n",
        "const escaped = md`# \\uFFFD`;\n",
        "const literal = md`# \u{fffd}`;",
    );

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(response.templates.len(), 4);

    let unsupported = &response.templates[0];
    assert_eq!(unsupported.status, PromptTextAnalysisStatus::Unsupported);
    assert_eq!(unsupported.candidate_id, 0);
    assert_ne!(unsupported.range.start, unsupported.range.end);
    assert_ne!(unsupported.tag_range.start, unsupported.tag_range.end);
    assert_ne!(
        unsupported.template_range.start,
        unsupported.template_range.end
    );
    assert!(unsupported.literal_islands.is_empty());
    assert!(unsupported.interpolation_barriers.is_empty());
    assert!(unsupported.mappings.is_empty());
    assert!(unsupported.blocks.is_empty());
    assert!(unsupported.spans.is_empty());
    assert!(unsupported.links.is_empty());
    assert!(unsupported.nesting.is_empty());
    assert!(unsupported.preview.text.is_empty());
    assert!(unsupported.preview.segments.is_empty());

    let pair = &response.templates[1];
    assert_eq!(pair.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(pair.literal_islands[0].projection_length, 4);
    assert!(matches!(
        pair.blocks.as_slice(),
        [PromptTextBlock::Heading { level: 1, .. }]
    ));
    let pair_mapping = pair
        .mappings
        .iter()
        .find(|mapping| mapping.projection_range == (PromptTextOffsetRange { start: 2, end: 4 }))
        .expect("paired surrogate mapping");
    assert_eq!(
        pair_mapping.source_range,
        authored_range(source, "\\uD83D\\u{DE00}")
    );

    for template in [&response.templates[2], &response.templates[3]] {
        assert_eq!(template.status, PromptTextAnalysisStatus::Complete);
        assert_eq!(template.literal_islands[0].projection_length, 3);
        assert!(matches!(
            template.blocks.as_slice(),
            [PromptTextBlock::Heading { level: 1, .. }]
        ));
    }
    assert!(
        response.templates[2]
            .mappings
            .iter()
            .any(|mapping| mapping.source_range == authored_range(source, "\\uFFFD"))
    );
    assert!(response.templates[3].mappings.iter().any(|mapping| {
        mapping.projection_range == (PromptTextOffsetRange { start: 0, end: 3 })
            && mapping.source_range == authored_range(source, "# \u{fffd}")
    }));
}

#[test]
fn prompt_text_surrogates_do_not_pair_across_an_interpolation_barrier() {
    let source = concat!(
        "const split = md`# \\uD83D${value}\\u{DE00}`;\n",
        "const low = md`# \\uDE00`;\n",
        "const valid = md`# retained`;",
    );

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(response.templates.len(), 3);
    assert_eq!(
        response.templates[0].status,
        PromptTextAnalysisStatus::Unsupported
    );
    assert!(response.templates[0].literal_islands.is_empty());
    assert!(response.templates[0].interpolation_barriers.is_empty());
    assert_eq!(
        response.templates[1].status,
        PromptTextAnalysisStatus::Unsupported
    );
    assert!(response.templates[1].literal_islands.is_empty());
    assert_eq!(
        response.templates[2].status,
        PromptTextAnalysisStatus::Complete
    );
    assert!(matches!(
        response.templates[2].blocks.as_slice(),
        [PromptTextBlock::Heading { level: 1, .. }]
    ));
}

#[test]
fn prompt_text_surrogate_pair_can_span_a_removed_line_continuation() {
    let source = "const pair = md`# \\uD83D\\\n\\u{DE00}`;";

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(response.templates.len(), 1);
    let template = &response.templates[0];
    assert_eq!(template.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(template.literal_islands[0].projection_length, 4);
    assert!(matches!(
        template.blocks.as_slice(),
        [PromptTextBlock::Heading { level: 1, .. }]
    ));
    assert!(template.mappings.iter().any(|mapping| {
        mapping.projection_range == (PromptTextOffsetRange { start: 2, end: 4 })
            && mapping.source_range == authored_range(source, "\\uD83D\\\n\\u{DE00}")
    }));
}

fn authored_range(source: &str, authored: &str) -> PromptTextRange {
    let start = source.find(authored).expect("authored fixture text");
    let end = start + authored.len();
    PromptTextRange {
        start: position(source, start),
        end: position(source, end),
    }
}

fn position(source: &str, byte_offset: usize) -> PromptTextPosition {
    let prefix = &source[..byte_offset];
    let line_start = prefix.rfind('\n').map_or(0, |offset| offset + 1);
    PromptTextPosition {
        line: prefix.bytes().filter(|byte| *byte == b'\n').count() as u32,
        character: source[line_start..byte_offset].encode_utf16().count() as u32,
    }
}
