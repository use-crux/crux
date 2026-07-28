use crux_indexer_protocol::prompt_text::{PromptTextAnalysisStatus, PromptTextLineIsolationEdit};

use super::{analyze, request, support::text_at};

#[test]
fn proves_exact_start_middle_and_end_line_isolation_edits() {
    let cases = [
        (
            "const value = md`${items} tail`;",
            "${items} ",
            "${items}\n",
        ),
        (
            "const value = md`head ${items} tail`;",
            " ${items} ",
            "\n${items}\n",
        ),
        (
            "const value = md`head ${items}`;",
            " ${items}",
            "\n${items}",
        ),
    ];

    for (source, expected_text, new_text) in cases {
        let response = analyze(request(source));
        let proof = line_isolation(&response.templates[0]);

        assert_eq!(proof.expected_text, expected_text, "{source}");
        assert_eq!(proof.new_text, new_text, "{source}");
        assert_eq!(text_at(source, &proof.range), expected_text, "{source}");
        assert_eq!(proof.new_text.matches("${items}").count(), 1, "{source}");
    }
}

#[test]
fn chooses_source_local_crlf_and_copies_carrier_indentation() {
    let source = "const value = md`\r\n\t  head ${items} tail\r\n`;";
    let response = analyze(request(source));
    let proof = line_isolation(&response.templates[0]);

    assert_eq!(proof.expected_text, " ${items} ");
    assert_eq!(proof.new_text, "\r\n\t  ${items}\r\n\t  ");
    assert_eq!(text_at(source, &proof.range), proof.expected_text);
}

#[test]
fn chooses_each_side_eol_independently_and_preserves_nested_barrier_bytes() {
    let source = concat!(
        "const value = md`\r\n",
        "  head ${{ value: `nested ${item}` } /* keep */} tail\n",
        "`;",
    );
    let response = analyze(request(source));
    let proof = line_isolation(&response.templates[0]);

    assert_eq!(
        proof.expected_text,
        " ${{ value: `nested ${item}` } /* keep */} "
    );
    assert_eq!(
        proof.new_text,
        "\r\n  ${{ value: `nested ${item}` } /* keep */}\n  "
    );
    assert_eq!(text_at(source, &proof.range), proof.expected_text);
}

#[test]
fn suppresses_escape_derived_line_boundaries_and_nonlinear_gaps() {
    for source in [
        r"const value = md`head\n${items} tail`;",
        r"const value = md`head\t${items} tail`;",
    ] {
        let response = analyze(request(source));
        assert!(
            response.templates[0].interpolation_barriers[0]
                .line_isolation_edit
                .is_none(),
            "{source}"
        );
    }
}

#[test]
fn suppresses_layout_proof_for_multiple_interpolations_on_one_line() {
    let response = analyze(request("const value = md`head ${first} ${second} tail`;"));

    assert!(
        response.templates[0]
            .interpolation_barriers
            .iter()
            .all(|barrier| barrier.line_isolation_edit.is_none())
    );
}

#[test]
fn suppresses_layout_proof_when_markdown_structure_would_change() {
    let source = "const value = md`head ${items}    # tail`;";
    let response = analyze(request(source));

    assert!(
        response.templates[0].interpolation_barriers[0]
            .line_isolation_edit
            .is_none()
    );
}

#[test]
fn preserves_non_target_interpolations_and_translated_candidates() {
    let source = concat!(
        "const first = md`head ${items} tail\n",
        "${other}`;\n",
        "const second = md`# Unrelated`;\n",
    );
    let response = analyze(request(source));

    let barriers = &response.templates[0].interpolation_barriers;
    assert!(barriers[0].line_isolation_edit.is_some());
    assert!(barriers[1].line_isolation_edit.is_none());
    assert_eq!(response.templates[1].blocks.len(), 1);
}

#[test]
fn output_limit_counts_the_complete_line_isolation_proof() {
    let source = "const value = md`head ${items} tail`;";
    let unbounded = analyze(request(source));
    let template = &unbounded.templates[0];
    assert!(line_isolation(template).new_text.contains('\n'));
    let bytes = serde_json::to_vec(template)
        .expect("template should serialize")
        .len();

    let mut exact = request(source);
    exact.limits.max_output_bytes = u32::try_from(bytes).expect("fixture should fit");
    let exact = analyze(exact);
    assert_eq!(exact.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(exact.templates.len(), 1);
    assert!(line_isolation(&exact.templates[0]).new_text.contains('\n'));

    let mut under = request(source);
    under.limits.max_output_bytes = u32::try_from(bytes - 1).expect("fixture should fit");
    let under = analyze(under);
    assert_eq!(under.status, PromptTextAnalysisStatus::Truncated);
    assert!(under.templates.is_empty());
}

fn line_isolation(
    template: &crux_indexer_protocol::prompt_text::PromptTextTemplate,
) -> &PromptTextLineIsolationEdit {
    template.interpolation_barriers[0]
        .line_isolation_edit
        .as_ref()
        .expect("fixture should have a Rust-proven line isolation edit")
}
