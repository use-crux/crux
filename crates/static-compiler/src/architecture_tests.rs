use crate::pipeline;
use crate::protocol::ParseRequest;
use crate::protocol::static_index::{
    STATIC_INDEX_PROTOCOL_VERSION, StaticIndexAnalyzeFile, StaticIndexAnalyzeRequest,
    StaticIndexDigestIdentity, StaticIndexMethod, StaticIndexPlan, StaticIndexRunIdentity,
    StaticIndexSourceFile, StaticIndexVersionIdentity,
};

#[test]
fn syntax_frontend_is_pure_and_static_compiler_projects_facts() {
    let root = "/workspace/acme".to_string();
    let file = "src/prompts/refund.ts".to_string();
    let source = "export const refundPrompt = prompt({ id: 'refund' })".to_string();

    let record = crux_indexer_syntax_oxc::parse_source(ParseRequest {
        root: root.clone(),
        file: file.clone(),
        source: source.clone(),
        call_names: vec!["prompt".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("pure syntax frontend should parse supported source");

    assert_eq!(record.matches.len(), 1);
    assert!(
        record.native_facts.is_empty(),
        "pure syntax parse must not project native facts"
    );

    let output = pipeline::analyze(&StaticIndexAnalyzeRequest {
        protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
        method: StaticIndexMethod::Analyze,
        stream: true,
        identity: static_index_identity(),
        plan: StaticIndexPlan {
            root,
            project_name: Some("acme".to_string()),
            files: vec![source_file(&file)],
            primary_files: Some(vec![source_file(&file)]),
            cache_hits: Vec::new(),
            cache_misses: vec![source_file(&file)],
            call_names: vec!["prompt".to_string()],
            call_interests: Vec::new(),
            constructor_names: Vec::new(),
            constructor_interests: Vec::new(),
            prune_native_fact_call_names: Vec::new(),
        },
        files: vec![StaticIndexAnalyzeFile {
            file,
            source_hash: "sha256:source-refund".to_string(),
            source_text: Some(source),
        }],
        extension_evidence_interests: None,
    });

    let (_, facts, _) = output.into_wire_parts();
    assert!(
        facts.iter().any(|fact| fact
            .get("definitions")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|definitions| definitions.iter().any(|definition| {
                definition.get("id").and_then(serde_json::Value::as_str) == Some("prompt:refund")
            }))),
        "static compiler pipeline should own first-party primitive projection"
    );
}

fn source_file(file: &str) -> StaticIndexSourceFile {
    StaticIndexSourceFile {
        file: file.to_string(),
        source_hash: "sha256:source-refund".to_string(),
        cache_key: None,
    }
}

fn static_index_identity() -> StaticIndexRunIdentity {
    StaticIndexRunIdentity {
        protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
        compiler: version_identity("crux-static-index", "0.1.0"),
        oxc: version_identity("oxc-rust", "oxc_parser@0.133.0+crux_native_group3.5"),
        primitive_manifest: digest_identity("crux-first-party-primitives"),
        relation_policy: digest_identity("crux-relation-policy"),
        extension_manifests: Vec::new(),
        rule_descriptors: digest_identity("crux-indexer-rule-descriptors"),
        compiler_projection: digest_identity("crux-static-projection"),
    }
}

fn version_identity(name: &str, version: &str) -> StaticIndexVersionIdentity {
    StaticIndexVersionIdentity {
        name: name.to_string(),
        version: version.to_string(),
    }
}

fn digest_identity(name: &str) -> StaticIndexDigestIdentity {
    StaticIndexDigestIdentity {
        name: name.to_string(),
        version: "phase-9-test".to_string(),
        digest: Some(format!("sha256:{name}")),
    }
}
