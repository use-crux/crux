use crux_indexer_protocol::{ParseRequest, StaticSourceMatch, StaticSyntaxValue};

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

#[test]
fn parse_source_uses_only_initializers_declared_before_the_match() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/prompts/refund.ts".to_string(),
        source: [
            "function define() {",
            "  const before = { id: 'before' }",
            "  const matched = prompt({ input: before, output: after })",
            "  const after = { id: 'after' }",
            "}",
        ]
        .join("\n"),
        call_names: vec!["prompt".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    let matched = record
        .matches
        .iter()
        .find(|match_record| match_variable_name(match_record) == "matched")
        .expect("prompt initializer should produce a named match");
    assert_eq!(local_initializer_names(matched), vec!["before"]);
}

#[test]
fn parse_source_prefers_inner_initializer_shadow_over_parent_scope() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/prompts/refund.ts".to_string(),
        source: [
            "function define() {",
            "  const config = { id: 'outer' }",
            "  const outer = prompt(config)",
            "  const run = () => {",
            "    const config = { id: 'inner' }",
            "    const inner = prompt(config)",
            "  }",
            "}",
        ]
        .join("\n"),
        call_names: vec!["prompt".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    let outer = record
        .matches
        .iter()
        .find(|match_record| match_variable_name(match_record) == "outer")
        .expect("outer prompt initializer should produce a named match");
    assert_eq!(local_initializer_snippets(outer), vec!["{ id: 'outer' }"]);

    let inner = record
        .matches
        .iter()
        .find(|match_record| match_variable_name(match_record) == "inner")
        .expect("inner prompt initializer should produce a named match");
    let snippets = local_initializer_snippets(inner);
    assert!(snippets.contains(&"{ id: 'inner' }"));
    assert!(!snippets.contains(&"{ id: 'outer' }"));
}

#[test]
fn parse_source_does_not_match_import_interest_when_import_is_shadowed() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/prompts/refund.ts".to_string(),
        source: [
            "import { prompt } from '@use-crux/core'",
            "function define() {",
            "  const prompt = (input) => input",
            "  const refund = prompt({ id: 'refund' })",
            "}",
        ]
        .join("\n"),
        call_names: Vec::new(),
        call_interests: vec![crux_indexer_protocol::StaticSyntaxCallInterest {
            name: "prompt".to_string(),
            import_from: vec!["@use-crux/core".to_string()],
            config_arg: None,
            properties: Vec::new(),
            callbacks: Vec::new(),
            source: None,
        }],
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    assert!(
        record.matches.is_empty(),
        "a local binding named prompt must not satisfy an import-scoped interest"
    );
}

#[test]
fn parse_source_matches_import_interest_when_reference_resolves_to_import() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/prompts/refund.ts".to_string(),
        source: [
            "import { prompt as cruxPrompt } from '@use-crux/core'",
            "import * as crux from '@use-crux/core'",
            "export const direct = cruxPrompt({ id: 'direct' })",
            "export const member = crux.prompt({ id: 'member' })",
        ]
        .join("\n"),
        call_names: Vec::new(),
        call_interests: vec![crux_indexer_protocol::StaticSyntaxCallInterest {
            name: "prompt".to_string(),
            import_from: vec!["@use-crux/core".to_string()],
            config_arg: None,
            properties: Vec::new(),
            callbacks: Vec::new(),
            source: None,
        }],
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
        vec!["direct", "member"]
    );
}

#[test]
fn parse_source_resolves_function_return_identifiers_by_semantic_binding() {
    let record = parse_source(ParseRequest {
        root: "/workspace/acme".to_string(),
        file: "/workspace/acme/src/tools.ts".to_string(),
        source: [
            "function makeTools() {",
            "  const tools = { search: searchTool }",
            "  {",
            "    const tools = { wrong: wrongTool }",
            "  }",
            "  return tools",
            "  {",
            "    const tools = { late: lateTool }",
            "  }",
            "}",
        ]
        .join("\n"),
        call_names: Vec::new(),
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("supported TypeScript source should parse");

    let initializer = record
        .local_initializers
        .iter()
        .find(|initializer| initializer.name == "makeTools")
        .expect("function declaration should be recorded as a local initializer");
    let StaticSyntaxValue::Function { returns, .. } = &initializer.value else {
        panic!("function declaration initializer should be a function value");
    };
    let Some(StaticSyntaxValue::Object { properties, .. }) = returns.first() else {
        panic!("return identifier should be resolved to its bound object value");
    };

    assert_eq!(
        properties
            .iter()
            .map(|property| property.name.as_str())
            .collect::<Vec<_>>(),
        vec!["search"]
    );
}

fn match_variable_name(match_record: &StaticSourceMatch) -> &str {
    match match_record {
        StaticSourceMatch::Call { variable_name, .. }
        | StaticSourceMatch::New { variable_name, .. }
        | StaticSourceMatch::Object { variable_name, .. } => variable_name,
    }
}

fn local_initializer_names(match_record: &StaticSourceMatch) -> Vec<&str> {
    match match_record {
        StaticSourceMatch::Call {
            local_initializers, ..
        }
        | StaticSourceMatch::New {
            local_initializers, ..
        }
        | StaticSourceMatch::Object {
            local_initializers, ..
        } => local_initializers
            .iter()
            .map(|initializer| initializer.name.as_str())
            .collect(),
    }
}

fn local_initializer_snippets(match_record: &StaticSourceMatch) -> Vec<&str> {
    match match_record {
        StaticSourceMatch::Call {
            local_initializers, ..
        }
        | StaticSourceMatch::New {
            local_initializers, ..
        }
        | StaticSourceMatch::Object {
            local_initializers, ..
        } => local_initializers
            .iter()
            .filter_map(|initializer| {
                initializer
                    .snippet
                    .as_ref()
                    .map(|snippet| snippet.source.as_str())
            })
            .collect(),
    }
}
