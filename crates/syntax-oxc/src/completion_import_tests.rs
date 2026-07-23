use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest,
};
use serde_json::json;

use crate::completion::complete;

#[test]
fn reuses_an_existing_named_import_alias() {
    let response = query(
        "import { agent } from '@use-crux/core/agent'\n\
         import { writer as authoredWriter } from './prompts'\n\
         const support = agent({ prompt: auth",
        "/workspace/src/agent.ts",
        CompletionPosition {
            line: 2,
            character: 36,
        },
        vec![candidate(
            "prompt:writer",
            "writer",
            "/workspace/src/prompts.ts",
        )],
    );

    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "isIncomplete": false,
            "items": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "label": "authoredWriter",
                "detail": "prompt · prompt:writer · ./prompts.ts",
                "insertText": "authoredWriter",
                "replacement": {
                    "start": { "line": 2, "character": 32 },
                    "end": { "line": 2, "character": 36 }
                },
                "additionalTextEdits": []
            }]
        })
    );
}

#[test]
fn merges_a_named_import_without_overlapping_the_main_edit() {
    let response = query(
        "import { agent } from '@use-crux/core/agent'\n\
         import { helper } from './prompts'\n\
         const support = agent({ prompt: wr",
        "/workspace/src/agent.ts",
        CompletionPosition {
            line: 2,
            character: 34,
        },
        vec![candidate(
            "prompt:writer",
            "writer",
            "/workspace/src/prompts.ts",
        )],
    );

    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "isIncomplete": false,
            "items": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "label": "writer",
                "detail": "prompt · prompt:writer · ./prompts.ts",
                "insertText": "writer",
                "replacement": {
                    "start": { "line": 2, "character": 32 },
                    "end": { "line": 2, "character": 34 }
                },
                "additionalTextEdits": [{
                    "range": {
                        "start": { "line": 1, "character": 15 },
                        "end": { "line": 1, "character": 16 }
                    },
                    "newText": ", writer "
                }]
            }]
        })
    );
}

#[test]
fn inserts_one_relative_extensionless_import_in_the_buffer_style() {
    let response = query(
        "import { agent } from '@use-crux/core/agent'\n\n\
         const support = agent({ prompt: wr",
        "/workspace/src/agent.ts",
        CompletionPosition {
            line: 2,
            character: 34,
        },
        vec![candidate(
            "prompt:writer",
            "writer",
            "/workspace/src/prompts/writer.ts",
        )],
    );

    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "isIncomplete": false,
            "items": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "label": "writer",
                "detail": "prompt · prompt:writer · ./prompts/writer.ts",
                "insertText": "writer",
                "replacement": {
                    "start": { "line": 2, "character": 32 },
                    "end": { "line": 2, "character": 34 }
                },
                "additionalTextEdits": [{
                    "range": {
                        "start": { "line": 1, "character": 0 },
                        "end": { "line": 1, "character": 0 }
                    },
                    "newText": "import { writer } from './prompts/writer'\n"
                }]
            }]
        })
    );
}

fn query(
    source: &str,
    file: &str,
    position: CompletionPosition,
    candidates: Vec<CompletionCandidate>,
) -> crux_indexer_protocol::completion::CompletionQueryResponse {
    complete(CompletionQueryRequest {
        file: file.to_string(),
        language_id: "typescript".to_string(),
        source: source.to_string(),
        position,
        candidates,
        limit: 100,
    })
}

fn candidate(id: &str, binding: &str, file: &str) -> CompletionCandidate {
    CompletionCandidate {
        id: id.to_string(),
        kind: "prompt".to_string(),
        name: binding.to_string(),
        binding: binding.to_string(),
        file: file.to_string(),
        line: 0,
        character: 0,
        description: None,
    }
}
