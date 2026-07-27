use crux_indexer_protocol::prompt_text::{
    PromptTextEvidenceProof, PromptTextFragment, PromptTextFragmentJoin,
    PromptTextInterpolationJoinKey, PromptTextPreviewEvidence, PromptTextPreviewSegment,
};

use super::super::{analyze, range, request};

#[test]
fn preview_expands_same_binding_document_fragments_before_parent_indentation() {
    let source = concat!(
        "const item = md`",
        "\n  - One",
        "\n  - ${2}",
        "\n`;\n",
        "const catalogue = { note: md`",
        "\n  > Note",
        "\n` };\n",
        "const root = md`",
        "\n  Items:",
        "\n    ${item}",
        "\n    ${catalogue.note}",
        "\n    ${md`- Direct`}",
        "\n    ${other`- Wrong tag`}",
        "\n`;\n",
    );
    let response = analyze(request(source));
    let root = &response.templates[2];

    assert_eq!(
        root.preview.text,
        concat!(
            "Items:\n",
            "  - One\n",
            "  - 2\n",
            "  > Note\n",
            "  - Direct\n",
            "  ⟪unknown⟫",
        ),
    );
    assert!(
        root.preview.segments.iter().any(|segment| matches!(
            segment,
            PromptTextPreviewSegment::Fragment { fragment_id, .. }
                if fragment_id.starts_with("document:")
        )),
        "same-document bytes must retain document:<candidateId> provenance",
    );
}

#[test]
fn preview_does_not_join_tags_without_a_resolved_canonical_binding() {
    let source = "const root = getTag()`before ${otherTag()`secret`} after`;";
    let response = analyze(request(source));
    let root = &response.templates[0].preview;

    assert_eq!(root.text, "before ⟪unknown⟫ after");
    assert!(!root.text.contains("secret"));
}

#[test]
fn preview_fails_closed_for_missing_or_incomplete_local_fragment_targets() {
    let cases = [
        (
            "max templates",
            "const root = md`before ${target} after`;\nconst target = md`secret`;",
            Some((1_u32, u32::MAX)),
            "before ⟪unknown⟫ after",
        ),
        (
            "unsupported target",
            "const root = md`before ${target} after`;\nconst target = md`\\uD800`;",
            None,
            "before ⟪unknown⟫ after",
        ),
        (
            "oversized target",
            "const root = md`${target}`;\nconst target = md`secret`;",
            Some((u32::MAX, 5_u32)),
            "⟪unknown⟫",
        ),
    ];
    for (name, source, limits, expected) in cases {
        let mut query = request(source);
        if let Some((templates, template_bytes)) = limits {
            query.limits.max_templates = templates;
            query.limits.max_template_bytes = template_bytes;
        }
        let response = analyze(query);
        assert_eq!(response.templates[0].preview.text, expected, "{name}",);
    }
}

#[test]
fn preview_accepts_only_rust_matched_semantic_fragment_joins() {
    let source = "const root = md`before ${shared} after`;";
    let template_start = source.find("md`").expect("template");
    let template_end = source.rfind('`').expect("template end") + 1;
    let expression_start = source.find("shared").expect("expression");
    let expression_end = expression_start + "shared".len();
    let fragment_source = "md`Shared`";
    let mut query = request(source);
    query.fragments.push(PromptTextFragment {
        id: "source-ref:shared".into(),
        symbol: "shared".into(),
        file: "/repo/src/shared.ts".into(),
        source_hash: "fragment-hash".into(),
        range: range(4, 2, 4, 2 + fragment_source.len() as u32),
        snippet: fragment_source.into(),
    });
    query.fragment_joins.push(PromptTextFragmentJoin {
        key: PromptTextInterpolationJoinKey {
            file: query.file.clone(),
            source_hash: query.revision.source_hash.clone(),
            template_range: range(0, template_start as u32, 0, template_end as u32),
            interpolation: 0,
            expression_range: range(0, expression_start as u32, 0, expression_end as u32),
        },
        fragment_id: "source-ref:shared".into(),
        proof: PromptTextEvidenceProof::SemanticExact,
    });

    let mut mismatched = query.clone();
    mismatched.fragment_joins[0]
        .key
        .expression_range
        .end
        .character -= 1;
    let mismatched = analyze(mismatched);
    assert_eq!(
        mismatched.templates[0].preview.text,
        "before ⟪unknown⟫ after"
    );
    assert_eq!(
        mismatched.templates[0].preview.evidence,
        Some(PromptTextPreviewEvidence::SyntaxExact)
    );

    let preview = &analyze(query).templates[0].preview;
    assert_eq!(preview.text, "before Shared after");
    assert_eq!(
        preview.evidence,
        Some(PromptTextPreviewEvidence::SemanticExact)
    );
    assert!(preview.segments.iter().any(|segment| matches!(
        segment,
        PromptTextPreviewSegment::Fragment {
            text,
            fragment_id,
            source_hash,
        } if text == "Shared"
            && fragment_id == "source-ref:shared"
            && source_hash == "fragment-hash"
    )));
}

#[test]
fn preview_keeps_nested_local_provenance_inside_a_semantic_fragment() {
    let source = "const root = md`${shared}`;";
    let fragment_source = "md`Outer ${md`Inner`}`";
    let mut query = request(source);
    query.fragments.push(PromptTextFragment {
        id: "source-ref:shared".into(),
        symbol: "shared".into(),
        file: "/repo/src/shared.ts".into(),
        source_hash: "fragment-hash".into(),
        range: range(0, 0, 0, fragment_source.len() as u32),
        snippet: fragment_source.into(),
    });
    query.fragment_joins.push(join_for_single_line(
        &query.file,
        &query.revision.source_hash,
        source,
        "shared",
        "source-ref:shared",
    ));

    let preview = &analyze(query).templates[0].preview;
    assert_eq!(preview.text, "Outer Inner");
    assert_eq!(
        preview
            .segments
            .iter()
            .filter_map(|segment| match segment {
                PromptTextPreviewSegment::Fragment { fragment_id, .. } => {
                    Some(fragment_id.as_str())
                }
                _ => None,
            })
            .collect::<Vec<_>>(),
        vec!["source-ref:shared", "document:1"],
    );
}

#[test]
fn preview_bounds_semantic_fragment_provenance_across_lines() {
    let source = "const root = md`${shared}`;";
    let fragment_source = "md`a\nb`";
    let mut query = request(source);
    query.limits.max_preview_bytes = 1;
    query.fragments.push(PromptTextFragment {
        id: "source-ref:shared".into(),
        symbol: "shared".into(),
        file: "/repo/src/shared.ts".into(),
        source_hash: "fragment-hash".into(),
        range: range(0, 0, 1, 2),
        snippet: fragment_source.into(),
    });
    query.fragment_joins.push(join_for_single_line(
        &query.file,
        &query.revision.source_hash,
        source,
        "shared",
        "source-ref:shared",
    ));

    let preview = &analyze(query).templates[0].preview;
    assert_eq!(preview.text, "");
    assert!(preview.segments.is_empty());
    assert_eq!(
        preview.truncation.as_ref().map(|value| value.emitted_bytes),
        Some(0),
    );
}

#[test]
fn preview_detects_semantic_fragment_cycles_on_the_active_stack() {
    let source = "const root = md`root ${first}`;";
    let first = "md`first ${second}`";
    let second = "md`second ${first}`";
    let mut query = request(source);
    query.fragments = vec![
        PromptTextFragment {
            id: "first".into(),
            symbol: "first".into(),
            file: "/repo/src/first.ts".into(),
            source_hash: "first-hash".into(),
            range: range(0, 0, 0, first.len() as u32),
            snippet: first.into(),
        },
        PromptTextFragment {
            id: "second".into(),
            symbol: "second".into(),
            file: "/repo/src/second.ts".into(),
            source_hash: "second-hash".into(),
            range: range(0, 0, 0, second.len() as u32),
            snippet: second.into(),
        },
    ];
    query.fragment_joins = vec![
        join_for_single_line(
            &query.file,
            &query.revision.source_hash,
            source,
            "first",
            "first",
        ),
        join_for_single_line(
            "/repo/src/first.ts",
            "first-hash",
            first,
            "second",
            "second",
        ),
        join_for_single_line(
            "/repo/src/second.ts",
            "second-hash",
            second,
            "first",
            "first",
        ),
    ];

    let preview = &analyze(query).templates[0].preview;
    assert_eq!(preview.text, "root first second ⟪unknown⟫");
    assert_eq!(
        preview.evidence,
        Some(PromptTextPreviewEvidence::SemanticExact)
    );
    let fragment_ids = preview
        .segments
        .iter()
        .filter_map(|segment| match segment {
            PromptTextPreviewSegment::Fragment { fragment_id, .. } => Some(fragment_id.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(fragment_ids, vec!["first", "second"]);
}

fn join_for_single_line(
    file: &str,
    source_hash: &str,
    source: &str,
    expression: &str,
    fragment_id: &str,
) -> PromptTextFragmentJoin {
    let template_start = source.find("md`").expect("template");
    let template_end = source.rfind('`').expect("template end") + 1;
    let expression_start = source.find(expression).expect("expression");
    PromptTextFragmentJoin {
        key: PromptTextInterpolationJoinKey {
            file: file.into(),
            source_hash: source_hash.into(),
            template_range: range(0, template_start as u32, 0, template_end as u32),
            interpolation: 0,
            expression_range: range(
                0,
                expression_start as u32,
                0,
                (expression_start + expression.len()) as u32,
            ),
        },
        fragment_id: fragment_id.into(),
        proof: PromptTextEvidenceProof::SemanticExact,
    }
}
