use serde_json::Value;

use crate::{
    process::WorkerResponseEnvelope,
    prompt_text::{PromptTextQueryResponse, PromptTextWorkerRequest},
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
    assert_eq!(
        serde_json::to_value(WorkerResponseEnvelope::ok(401, response))
            .expect("response should serialize"),
        fixture["response"]
    );
}
