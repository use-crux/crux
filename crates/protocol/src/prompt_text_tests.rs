use serde_json::Value;

use crate::{
    process::WorkerResponseEnvelope,
    prompt_text::{
        PromptTextAnalysisStatus, PromptTextBlock, PromptTextQueryResponse,
        PromptTextRefactorProof, PromptTextWorkerRequest,
    },
};

const GOLDEN: &str =
    include_str!("../../../packages/indexer/src/contracts/fixtures/prompt-text-query-v1.json");

#[test]
fn prompt_text_v1_matches_the_shared_golden_abi() {
    let fixture: Value = serde_json::from_str(GOLDEN).expect("golden fixture should decode");
    let request: PromptTextWorkerRequest =
        serde_json::from_value(fixture["request"].clone()).expect("golden request should decode");
    assert_eq!(
        serde_json::to_value(request).expect("request should serialize"),
        fixture["request"]
    );

    let response: PromptTextQueryResponse =
        serde_json::from_value(fixture["response"]["response"].clone())
            .expect("golden response should decode");
    assert_eq!(response.templates[0].backtick_ranges.len(), 2);
    assert_eq!(
        response.templates[2].status,
        PromptTextAnalysisStatus::Unsupported
    );
    assert_eq!(response.templates[2].backtick_ranges.len(), 2);
    assert!(response.templates[2].literal_islands.is_empty());
    assert_eq!(
        response.refactors.status,
        PromptTextAnalysisStatus::Complete
    );
    assert!(matches!(
        response.refactors.proofs.as_slice(),
        [PromptTextRefactorProof::OrdinaryStringToMd {
            candidate_id: 0,
            expected_text,
            template_text,
            ..
        }] if expected_text == "\"first\\nsecond\"" &&
            template_text == "`\nfirst\nsecond\n`"
    ));
    assert_eq!(
        serde_json::to_value(WorkerResponseEnvelope::ok(401, response))
            .expect("response should serialize"),
        fixture["response"]
    );
}

#[test]
fn prompt_text_v1_rejects_unknown_record_and_variant_fields() {
    let fixture: Value = serde_json::from_str(GOLDEN).expect("golden fixture should decode");

    let mut request = fixture["request"].clone();
    request["query"]
        .as_object_mut()
        .expect("golden query")
        .insert("futureField".into(), Value::Bool(true));
    assert!(
        serde_json::from_value::<PromptTextWorkerRequest>(request).is_err(),
        "unknown query records must fail closed",
    );

    let mut response = fixture["response"]["response"].clone();
    response["templates"][0]["preview"]["segments"][0]
        .as_object_mut()
        .expect("golden preview segment")
        .insert("futureField".into(), Value::Bool(true));
    assert!(
        serde_json::from_value::<PromptTextQueryResponse>(response).is_err(),
        "unknown variant fields must fail closed",
    );
}

#[test]
fn prompt_text_heading_label_is_required_and_nonempty() {
    let fixture: Value = serde_json::from_str(GOLDEN).expect("golden fixture should decode");
    for label in [None, Some("")] {
        let mut response = fixture["response"]["response"].clone();
        let heading = response["templates"][0]["blocks"][0]
            .as_object_mut()
            .expect("golden heading should be an object");
        match label {
            Some(value) => {
                heading.insert("label".into(), Value::String(value.into()));
            }
            None => {
                heading.remove("label");
            }
        }
        assert!(
            serde_json::from_value::<PromptTextQueryResponse>(response).is_err(),
            "heading label {label:?} must be rejected"
        );
    }

    let mut response: PromptTextQueryResponse =
        serde_json::from_value(fixture["response"]["response"].clone())
            .expect("golden response should decode");
    let PromptTextBlock::Heading { label, .. } = &mut response.templates[0].blocks[0] else {
        panic!("golden block should be a heading");
    };
    label.clear();
    assert!(
        serde_json::to_value(response).is_err(),
        "an empty Rust-produced heading label must not serialize"
    );
}
