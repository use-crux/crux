use std::path::{Path, PathBuf};

use crate::protocol::ParseRequest;
use crate::protocol::native_static::{
    NATIVE_STATIC_PROTOCOL_VERSION, NativeStaticAnalyzeFile, NativeStaticAnalyzeRequest,
    NativeStaticDigestIdentity, NativeStaticMethod, NativeStaticPlan, NativeStaticRunIdentity,
    NativeStaticSourceFile, NativeStaticVersionIdentity,
};

fn crate_src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

#[test]
fn phase8_rust_runtime_boundaries_use_target_module_names() {
    let src = crate_src();

    for path in [
        "server/mod.rs",
        "server/static_syntax.rs",
        "server/native_static.rs",
        "protocol/worker.rs",
        "protocol/static_syntax.rs",
        "protocol/native_static.rs",
        "native_static/mod.rs",
        "native_static/pipeline.rs",
    ] {
        assert!(
            src.join(path).is_file(),
            "expected Phase 8 Rust boundary file {path}"
        );
    }

    for path in [
        "serve.rs",
        "worker",
        "protocol/static_compile.rs",
        "protocol/static_compiler.rs",
        "protocol/syntax_record.rs",
        "protocol/syntax_worker.rs",
    ] {
        assert!(
            !src.join(path).exists(),
            "old Phase 8 Rust boundary path should be removed: {path}"
        );
    }
}

#[test]
fn phase9_syntax_frontend_is_pure_and_native_static_pipeline_projects_facts() {
    let root = "/workspace/acme".to_string();
    let file = "src/prompts/refund.ts".to_string();
    let source = "export const refundPrompt = prompt({ id: 'refund' })".to_string();

    let record = crate::syntax::frontend::parse_source(ParseRequest {
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

    let output = crate::native_static::pipeline::analyze(&NativeStaticAnalyzeRequest {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        method: NativeStaticMethod::Analyze,
        stream: true,
        identity: native_static_identity(),
        plan: NativeStaticPlan {
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
        files: vec![NativeStaticAnalyzeFile {
            file,
            source_hash: "sha256:source-refund".to_string(),
            source_text: Some(source),
        }],
        extension_evidence_interests: None,
    });

    assert!(
        output.fact_groups.iter().any(|facts| facts
            .definitions
            .iter()
            .any(|definition| definition.id == "prompt:refund")),
        "native static pipeline should own first-party primitive projection"
    );
}

fn source_file(file: &str) -> NativeStaticSourceFile {
    NativeStaticSourceFile {
        file: file.to_string(),
        source_hash: "sha256:source-refund".to_string(),
        cache_key: None,
    }
}

fn native_static_identity() -> NativeStaticRunIdentity {
    NativeStaticRunIdentity {
        protocol_version: NATIVE_STATIC_PROTOCOL_VERSION,
        compiler: version_identity("crux-native-static", "0.1.0"),
        oxc: version_identity("oxc-rust", "oxc_parser@0.133.0+crux_native_group3.5"),
        primitive_manifest: digest_identity("crux-first-party-primitives"),
        relation_policy: digest_identity("crux-relation-policy"),
        extension_manifests: Vec::new(),
        first_party_graph_rules: digest_identity("crux-first-party-graph-rules"),
        compiler_projection: digest_identity("crux-static-projection"),
    }
}

fn version_identity(name: &str, version: &str) -> NativeStaticVersionIdentity {
    NativeStaticVersionIdentity {
        name: name.to_string(),
        version: version.to_string(),
    }
}

fn digest_identity(name: &str) -> NativeStaticDigestIdentity {
    NativeStaticDigestIdentity {
        name: name.to_string(),
        version: "phase-9-test".to_string(),
        digest: Some(format!("sha256:{name}")),
    }
}
