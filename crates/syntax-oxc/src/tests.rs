use crux_indexer_protocol::ParseRequest;

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
        "syntax crate must not project native static facts"
    );
}
