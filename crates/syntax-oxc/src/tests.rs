use crux_indexer_protocol::{ParseRequest, StaticSourceMatch};

use crate::parse_source;

#[test]
fn parse_source_emits_pure_static_syntax_record() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "src/prompts/refund.ts".to_string(),
        source: "export const refundPrompt = prompt({ id: 'refund' })".to_string(),
        call_names: vec!["prompt".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    assert_eq!(record.frontend.name, crate::FRONTEND_NAME);
    assert_eq!(record.matches.len(), 1);
    assert!(
        record.native_facts.is_empty(),
        "syntax crate must not project Static Index facts"
    );
}

#[test]
fn parse_source_matches_nested_variable_statement_initializers() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/prompts/refund.ts".to_string(),
        source: [
            "const local = withRetry(prompt({ id: 'local' }))",
            "export const exported = withRetry(prompt({ id: 'exported' }))",
            "const { nested = prompt({ id: 'destructured' }) } = config",
            "async function surface() {",
            "  const { results } = await parallel({ agents: { writer }, context: {} })",
            "}",
        ]
        .join("\n"),
        call_names: vec!["prompt".to_string(), "parallel".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    assert_eq!(
        record
            .matches
            .iter()
            .map(match_variable_name)
            .collect::<Vec<_>>(),
        vec!["prompt-1", "prompt-2", "prompt-3", "parallel-5"]
    );
}

#[test]
fn parse_source_matches_nullish_fallback_calls_inside_initializers() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/storage.ts".to_string(),
        source: [
            "function create(config) {",
            "  const records = config.records ?? inMemoryRecordStore()",
            "  const store = config.records ?? config.storage?.records ?? inMemoryRecordStore()",
            "}",
        ]
        .join("\n"),
        call_names: vec!["inMemoryRecordStore".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    assert_eq!(
        record
            .matches
            .iter()
            .map(match_variable_name)
            .collect::<Vec<_>>(),
        vec!["inMemoryRecordStore-2", "inMemoryRecordStore-3"]
    );
}

fn match_variable_name(match_record: &StaticSourceMatch) -> &str {
    match match_record {
        StaticSourceMatch::Call { variable_name, .. }
        | StaticSourceMatch::New { variable_name, .. }
        | StaticSourceMatch::Object { variable_name, .. } => variable_name,
    }
}
