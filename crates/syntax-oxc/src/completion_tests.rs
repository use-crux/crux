use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest, CompletionRange,
};

use crate::completion::complete;

#[test]
fn completes_an_incomplete_agent_prompt_with_compatible_accessible_bindings() {
    let source = [
        "import { prompt, tool } from '@use-crux/core'",
        "import { agent } from '@use-crux/core/agent'",
        "const writer = prompt({ id: 'writer' })",
        "const lookup = tool({ id: 'lookup' })",
        "const support = agent({ prompt: wr",
    ]
    .join("\n");
    let response = complete(CompletionQueryRequest {
        file: "src/agent.ts".to_string(),
        language_id: "typescript".to_string(),
        source,
        position: CompletionPosition {
            line: 4,
            character: 34,
        },
        candidates: vec![
            candidate("prompt:writer", "prompt", "writer"),
            candidate("tool:lookup", "tool", "lookup"),
        ],
        limit: 100,
    });

    assert!(!response.is_incomplete);
    assert_eq!(response.items.len(), 1);
    let item = &response.items[0];
    assert_eq!(item.id, "prompt:writer");
    assert_eq!(item.label, "writer");
    assert_eq!(item.insert_text, "writer");
    assert_eq!(
        item.replacement,
        CompletionRange {
            start: CompletionPosition {
                line: 4,
                character: 32,
            },
            end: CompletionPosition {
                line: 4,
                character: 34,
            },
        }
    );
}

#[test]
fn completes_an_empty_agent_prompt_slot_triggered_by_colon() {
    let source = [
        "import { agent } from '@use-crux/core/agent'",
        "const writer = prompt({ id: 'writer' })",
        "const support = agent({ prompt: ",
    ]
    .join("\n");
    let response = complete(CompletionQueryRequest {
        file: "src/agent.ts".to_string(),
        language_id: "typescript".to_string(),
        source,
        position: CompletionPosition {
            line: 2,
            character: 32,
        },
        candidates: vec![candidate("prompt:writer", "prompt", "writer")],
        limit: 100,
    });

    assert_eq!(response.items.len(), 1);
    assert_eq!(
        response.items[0].replacement,
        CompletionRange {
            start: CompletionPosition {
                line: 2,
                character: 32,
            },
            end: CompletionPosition {
                line: 2,
                character: 32,
            },
        }
    );
}

#[test]
fn unknown_syntax_returns_no_crux_completion() {
    let source = [
        "import { prompt } from '@use-crux/core'",
        "const writer = prompt({ id: 'writer' })",
        "const ordinary = { prompt: wri }",
    ]
    .join("\n");
    let response = complete(CompletionQueryRequest {
        file: "src/agent.ts".to_string(),
        language_id: "typescript".to_string(),
        source,
        position: CompletionPosition {
            line: 2,
            character: 30,
        },
        candidates: vec![candidate("prompt:writer", "prompt", "writer")],
        limit: 100,
    });

    assert!(response.items.is_empty());
}

fn candidate(id: &str, kind: &str, binding: &str) -> CompletionCandidate {
    CompletionCandidate {
        id: id.to_string(),
        kind: kind.to_string(),
        name: binding.to_string(),
        binding: binding.to_string(),
        file: "src/agent.ts".to_string(),
        line: 0,
        character: 0,
        description: None,
    }
}
