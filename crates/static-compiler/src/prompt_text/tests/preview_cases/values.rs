use crux_indexer_protocol::prompt_text::{
    PromptTextPreviewEvidence, PromptTextPreviewSegment, PromptTextPreviewStatus,
};
use crux_indexer_syntax_oxc::prompt_text::ProjectedValue;

use super::super::{analyze, request, support::text_at};

#[test]
fn preview_reconstructs_literal_known_scalar_and_private_placeholder() {
    let source = r#"const value = md`literal ${"known"} ${mystery}`;"#;
    let preview = &analyze(request(source)).templates[0].preview;

    assert_eq!(preview.status, PromptTextPreviewStatus::Complete);
    assert_eq!(
        preview.evidence,
        Some(PromptTextPreviewEvidence::SyntaxExact)
    );
    assert_eq!(preview.text, "literal known ⟪unknown⟫");
    assert_eq!(
        preview
            .segments
            .iter()
            .map(|segment| match segment {
                PromptTextPreviewSegment::AuthoredLiteral { text, range } => {
                    assert_eq!(text_at(source, range), text.as_str());
                    text.as_str()
                }
                PromptTextPreviewSegment::KnownValue {
                    text,
                    interpolation,
                    interpolation_path,
                } => {
                    assert_eq!(
                        (*interpolation, interpolation_path.as_slice()),
                        (0, &[][..])
                    );
                    text.as_str()
                }
                PromptTextPreviewSegment::Placeholder {
                    text,
                    interpolation,
                    interpolation_path,
                } => {
                    assert_eq!(
                        (*interpolation, interpolation_path.as_slice()),
                        (1, &[][..])
                    );
                    assert_eq!(text, "⟪unknown⟫");
                    text.as_str()
                }
                segment => panic!("unexpected preview segment {segment:?}"),
            })
            .collect::<String>(),
        preview.text,
    );
    assert!(preview.truncation.is_none());
}

#[test]
fn preview_uses_ecmascript_number_bytes_and_omits_safe_empty_scalars() {
    let source = concat!(
        "const value = md`",
        "${-0}|${1e-7}|${1e-6}|${1e20}|${1e21}|${1e+22}|",
        "${false}|${null}|${undefined}|${true}",
        "`;",
    );
    let preview = &analyze(request(source)).templates[0].preview;

    assert_eq!(
        preview.text,
        "0|1e-7|0.000001|100000000000000000000|1e+21|1e+22||||⟪unknown⟫",
    );
    assert_eq!(
        preview
            .segments
            .iter()
            .map(|segment| match segment {
                PromptTextPreviewSegment::AuthoredLiteral { text, .. }
                | PromptTextPreviewSegment::KnownValue { text, .. }
                | PromptTextPreviewSegment::Fragment { text, .. }
                | PromptTextPreviewSegment::Placeholder { text, .. } => text.as_str(),
            })
            .collect::<String>(),
        preview.text,
    );
}

#[test]
fn preview_renders_only_safe_block_arrays_and_rejects_the_whole_unsafe_value() {
    let source = concat!(
        "const safe = md`",
        "\n  items:",
        "\n    ${[\"one\", false, [2, null], , `three`]}",
        "\n`;\n",
        "const inline = md`before ${[\"one\", \"two\"]} after`;\n",
        "const unsafeLeaf = md`",
        "\n  ${[\"safe\", call()]}",
        "\n`;\n",
        "const spread = md`",
        "\n  ${[\"safe\", ...rest]}",
        "\n`;\n",
    );
    let response = analyze(request(source));

    assert_eq!(
        response.templates[0].preview.text,
        "items:\n  one\n  2\n  three"
    );
    assert_eq!(response.templates[1].preview.text, "before ⟪unknown⟫ after");
    assert_eq!(response.templates[2].preview.text, "⟪unknown⟫");
    assert_eq!(response.templates[3].preview.text, "⟪unknown⟫");
}

#[test]
fn preview_renders_fragment_items_inside_safe_block_arrays() {
    let source = concat!(
        "const item = md`one\nsecond`;\n",
        "const root = md`",
        "\n  list:",
        "\n    ${[item, [\"tail\"]]}",
        "\n`;\n",
    );
    let response = analyze(request(source));
    let preview = &response.templates[1].preview;

    assert_eq!(preview.text, "list:\n  one\n  second\n  tail");
    assert!(preview.segments.iter().any(|segment| matches!(
        segment,
        PromptTextPreviewSegment::Fragment { text, fragment_id, .. }
            if text.contains("one") && fragment_id.starts_with("document:")
    )));
}

#[test]
fn preview_coalesces_adjacent_segments_with_identical_provenance() {
    let source = "const root = md`\n  ${[\"one\", \"two\"]}\n`;";
    let preview = &analyze(request(source)).templates[0].preview;
    let second_item = preview
        .segments
        .iter()
        .filter_map(|segment| match segment {
            PromptTextPreviewSegment::KnownValue {
                text,
                interpolation,
                interpolation_path,
            } if *interpolation == 0 && interpolation_path == &[1] => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(preview.text, "one\ntwo");
    assert_eq!(second_item, vec!["\ntwo"]);
}

#[test]
fn preview_matches_pretty_json_for_the_closed_inert_grammar() {
    let source = concat!(
        "const value = md`",
        "\n  payload:",
        "\n    ${md.json({",
        "z: 1, \"2\": \"two\", \"1\": \"one\", z: 2, skip: undefined, ",
        "values: [, undefined, 1e999, -1e999, -0], nested: { ok: true },",
        "})}",
        "\n`;\n",
        "const wrongReceiver = md`${other.json({ ok: true })}`;\n",
        "const unsafeCall = md`${md.json(call())}`;\n",
        "const unsafeProto = md`${md.json({ __proto__: null })}`;\n",
    );

    let simple = r#"const value = md`${md.json({ ok: true })}`;"#;
    let simple_projection = crux_indexer_syntax_oxc::prompt_text::project(&request(simple));
    assert!(
        matches!(
            simple_projection.templates[0].interpolations[0].value,
            ProjectedValue::Json(_)
        ),
        "simple receiver-matching JSON projection = {:?}",
        simple_projection.templates[0].interpolations[0].value,
    );
    let projection = crux_indexer_syntax_oxc::prompt_text::project(&request(source));
    assert!(
        matches!(
            projection.templates[0].interpolations[0].value,
            ProjectedValue::Json(_)
        ),
        "direct receiver-matching inert JSON projection = {:?}",
        projection.templates[0].interpolations[0].value,
    );
    let response = analyze(request(source));

    assert_eq!(
        response.templates[0].preview.text,
        concat!(
            "payload:\n  {\n",
            "    \"1\": \"one\",\n",
            "    \"2\": \"two\",\n",
            "    \"z\": 2,\n",
            "    \"values\": [\n",
            "      null,\n",
            "      null,\n",
            "      null,\n",
            "      null,\n",
            "      0\n",
            "    ],\n",
            "    \"nested\": {\n",
            "      \"ok\": true\n",
            "    }\n",
            "  }",
        ),
    );
    assert_eq!(response.templates[1].preview.text, "⟪unknown⟫");
    assert_eq!(response.templates[2].preview.text, "⟪unknown⟫");
    assert_eq!(response.templates[3].preview.text, "⟪unknown⟫");
}
