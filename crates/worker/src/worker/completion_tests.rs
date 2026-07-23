use serde_json::json;

use crate::protocol::completion::COMPLETION_QUERY_METHOD;
use crate::worker::static_index_tests::serve_response_json;

#[test]
fn completion_query_uses_the_persistent_worker_envelope() {
    let source = [
        "import { agent } from '@use-crux/core/agent'",
        "const writer = prompt({ id: 'writer' })",
        "const lookup = tool({ id: 'lookup' })",
        "const support = agent({ prompt: wr",
    ]
    .join("\n");
    let response = serve_response_json(json!({
        "id": 301,
        "method": COMPLETION_QUERY_METHOD,
        "query": {
            "file": "src/agent.ts",
            "languageId": "typescript",
            "source": source,
            "position": { "line": 3, "character": 34 },
            "candidates": [
                {
                    "id": "prompt:writer",
                    "kind": "prompt",
                    "name": "writer",
                    "binding": "writer",
                    "file": "src/agent.ts"
                },
                {
                    "id": "tool:lookup",
                    "kind": "tool",
                    "name": "lookup",
                    "binding": "lookup",
                    "file": "src/agent.ts"
                }
            ],
            "limit": 100
        }
    }));

    assert_eq!(response["id"], 301);
    assert_eq!(response["ok"], true);
    assert_eq!(response["response"]["isIncomplete"], false);
    assert_eq!(response["response"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(response["response"]["items"][0]["id"], "prompt:writer");
}
