use serde_json::Value;

use crate::worker::static_index_tests::serve_response_json;

const GOLDEN: &str =
    include_str!("../../../../packages/indexer/src/contracts/fixtures/prompt-text-query-v1.json");

#[test]
fn prompt_text_query_returns_the_shared_canonical_heading() {
    let fixture: Value = serde_json::from_str(GOLDEN).expect("golden fixture should decode");

    let response = serve_response_json(fixture["request"].clone());

    assert_eq!(response, fixture["response"]);
}
