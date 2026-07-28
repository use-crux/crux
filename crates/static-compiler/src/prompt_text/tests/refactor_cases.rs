use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextRefactorProof, PromptTextRefactorProofLevel,
};

use super::{analyze, request};

#[test]
fn quoted_multiline_string_emits_byte_exact_fixed_point_proof() {
    let source = "const value = prompt({\n  prompt: \"first\\nsecond\",\n});";
    let response = analyze(request(source));

    assert_eq!(
        response.refactors.status,
        PromptTextAnalysisStatus::Complete
    );
    assert_eq!(response.refactors.proofs.len(), 1);
    let PromptTextRefactorProof::OrdinaryStringToMd {
        candidate_id,
        expected_text,
        template_text,
        proof,
        ..
    } = &response.refactors.proofs[0];
    assert_eq!(*candidate_id, 0);
    assert_eq!(expected_text, "\"first\\nsecond\"");
    assert_eq!(*proof, PromptTextRefactorProofLevel::SyntaxExact);
    assert_eq!(template_text, "`\n  first\n  second\n  `");
}

#[test]
fn no_substitution_template_reuses_exact_authored_token() {
    let source = "const value = prompt({ prompt: `first\nsecond` });";
    let response = analyze(request(source));
    let PromptTextRefactorProof::OrdinaryStringToMd {
        expected_text,
        template_text,
        ..
    } = &response.refactors.proofs[0];
    assert_eq!(template_text, expected_text);
    assert_eq!(template_text, "`first\nsecond`");
}

#[test]
fn quoted_refactor_preserves_crlf_unicode_controls_and_template_syntax() {
    let source = concat!(
        "const value = prompt({\r\n",
        "\t'prompt': ('first\\nquotes: \" and \\' and \\\\ and ` and ",
        "${literal}\\r\\x01 café 😀\\tlast'),\r\n",
        "});",
    );
    let response = analyze(request(source));
    let PromptTextRefactorProof::OrdinaryStringToMd {
        expected_text,
        template_text,
        ..
    } = &response.refactors.proofs[0];

    assert_eq!(
        expected_text,
        "'first\\nquotes: \" and \\' and \\\\ and ` and \
         ${literal}\\r\\x01 café 😀\\tlast'"
    );
    assert_eq!(
        template_text,
        concat!(
            "`\r\n",
            "\tfirst\r\n",
            "\tquotes: \" and ' and \\\\ and \\` and \\${literal}",
            "\\r\\x01 café 😀\\tlast\r\n",
            "\t`",
        )
    );
}

#[test]
fn refactor_rejects_normalization_changes_and_non_direct_literals() {
    for source in [
        "const value = prompt({ prompt: \"\\n  first\\n  second\\n\" });",
        "const value = prompt({ prompt: \"  first\\n  second\" });",
        "const value = prompt({ prompt: \" \\n\\t\" });",
        "const text = \"first\\nsecond\"; const value = prompt({ prompt: text });",
        "const value = prompt({ prompt: \"first\" + \"\\nsecond\" });",
        "const value = prompt({ prompt: (`first\\n${name}`) });",
        "const value = prompt({ prompt: (\"first\\nsecond\" as string) });",
        "const value = prompt({ [\"prompt\"]: \"first\\nsecond\" });",
        "const prompt = \"first\\nsecond\"; const value = prompt({ prompt });",
        "const value = prompt({ prompt() { return \"first\\nsecond\" } });",
        "const value = prompt({ prompt: wrap(\"first\\nsecond\") });",
    ] {
        let response = analyze(request(source));
        assert!(
            response.refactors.proofs.is_empty(),
            "unexpected proof for {source:?}: {:?}",
            response.refactors.proofs,
        );
    }
}

#[test]
fn refactor_limits_retain_only_complete_source_order_prefixes() {
    let source = concat!(
        "const value = prompt({\n",
        "  prompt: \"first\\nsecond\",\n",
        "  system: \"third\\nfourth-extra\",\n",
        "});",
    );
    let complete = analyze(request(source));
    assert_eq!(complete.refactors.proofs.len(), 2);

    let mut count_limited = request(source);
    count_limited.limits.max_string_refactors = 1;
    let count_limited = analyze(count_limited);
    assert_eq!(
        count_limited.refactors.status,
        PromptTextAnalysisStatus::Truncated
    );
    assert_eq!(count_limited.refactors.proofs.len(), 1);

    let first_bytes = serde_json::to_vec(&complete.refactors.proofs[0])
        .expect("proof serializes")
        .len() as u32;
    let mut exact = request(source);
    exact.limits.max_string_refactor_output_bytes = first_bytes;
    let exact = analyze(exact);
    assert_eq!(exact.refactors.proofs.len(), 1);
    assert_eq!(exact.refactors.status, PromptTextAnalysisStatus::Truncated);

    let mut under = request(source);
    under.limits.max_string_refactor_output_bytes = first_bytes - 1;
    let under = analyze(under);
    assert!(under.refactors.proofs.is_empty());
    assert_eq!(under.refactors.status, PromptTextAnalysisStatus::Truncated);

    let PromptTextRefactorProof::OrdinaryStringToMd { expected_text, .. } =
        &complete.refactors.proofs[0];
    let mut exact_input = request(source);
    exact_input.limits.max_string_refactor_bytes = expected_text.len() as u32;
    let exact_input = analyze(exact_input);
    assert_eq!(exact_input.refactors.proofs.len(), 1);
    assert_eq!(
        exact_input.refactors.status,
        PromptTextAnalysisStatus::Truncated
    );

    let mut under_input = request(source);
    under_input.limits.max_string_refactor_bytes = expected_text.len() as u32 - 1;
    let under_input = analyze(under_input);
    assert!(under_input.refactors.proofs.is_empty());
    assert_eq!(
        under_input.refactors.status,
        PromptTextAnalysisStatus::Truncated
    );
}

#[test]
fn oversized_ineligible_refactor_candidate_still_truncates_analysis() {
    let source = "const value = prompt({ prompt: \"\\n  first line\\n  second line\\n\" });";
    let mut limited = request(source);
    limited.limits.max_string_refactor_bytes = 8;

    let response = analyze(limited);

    assert_eq!(
        response.refactors.status,
        PromptTextAnalysisStatus::Truncated
    );
    assert!(response.refactors.proofs.is_empty());
}
