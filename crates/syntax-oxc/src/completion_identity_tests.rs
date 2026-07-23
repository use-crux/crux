use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest,
};

use crate::completion::complete;

#[test]
fn completes_calls_from_approved_aliased_and_namespace_imports() {
    for source in [
        "import { agent as makeAgent } from '@use-crux/core/agent'\n\
         const writer = 1\n\
         const support = makeAgent({ prompt: wr|",
        "import * as cruxAgent from '@use-crux/core/agent'\n\
         const writer = 1\n\
         const support = cruxAgent.agent({ prompt: wr|",
    ] {
        let response = complete_at_marker(source);
        assert_eq!(
            response.items.len(),
            1,
            "approved first-party import should complete: {source}"
        );
        assert_eq!(response.items[0].id, "prompt:writer");
    }
}

#[test]
fn rejects_unproven_local_shadowed_and_reexported_call_names() {
    for source in [
        "const agent = (value) => value\n\
         const writer = 1\n\
         const support = agent({ prompt: wr|",
        "import { agent } from '@use-crux/core/agent'\n\
         const writer = 1\n\
         function define(agent) { return agent({ prompt: wr|",
        "import { agent } from '@acme/wrapper'\n\
         const writer = 1\n\
         const support = agent({ prompt: wr|",
        "import { agent } from './wrapper'\n\
         const writer = 1\n\
         const support = agent({ prompt: wr|",
        "import { agent } from '@use-crux/core'\n\
         const writer = 1\n\
         const support = agent({ prompt: wr|",
    ] {
        assert!(
            complete_at_marker(source).items.is_empty(),
            "unproven call identity must fail soft: {source}"
        );
    }
}

fn complete_at_marker(
    marked_source: &str,
) -> crux_indexer_protocol::completion::CompletionQueryResponse {
    let marker = marked_source.find('|').expect("completion marker");
    let source = marked_source.replacen('|', "", 1);
    let line_start = source[..marker].rfind('\n').map_or(0, |index| index + 1);
    let position = CompletionPosition {
        line: source[..marker]
            .bytes()
            .filter(|byte| *byte == b'\n')
            .count() as u32,
        character: source[line_start..marker].encode_utf16().count() as u32,
    };
    complete(CompletionQueryRequest {
        file: "src/agent.ts".to_string(),
        language_id: "typescript".to_string(),
        source,
        position,
        candidates: vec![CompletionCandidate {
            id: "prompt:writer".to_string(),
            kind: "prompt".to_string(),
            name: "writer".to_string(),
            binding: "writer".to_string(),
            file: "src/agent.ts".to_string(),
            line: 1,
            character: 0,
            description: None,
        }],
        limit: 100,
    })
}
