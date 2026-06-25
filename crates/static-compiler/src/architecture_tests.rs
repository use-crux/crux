use crate::pipeline;
use crate::protocol::ParseRequest;
use crate::protocol::static_index::{
    STATIC_INDEX_PROTOCOL_VERSION, StaticIndexAnalyzeFile, StaticIndexAnalyzeRequest,
    StaticIndexDigestIdentity, StaticIndexMethod, StaticIndexPlan, StaticIndexRunIdentity,
    StaticIndexSourceFile, StaticIndexVersionIdentity,
};

#[test]
fn rust_crates_keep_top_level_workspace_shape() {
    let static_compiler_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let crates = static_compiler_dir
        .parent()
        .expect("static compiler crate should live under crates/");
    let repo_root = crates
        .parent()
        .expect("crates directory should live at the repository root");

    for name in [
        "protocol",
        "syntax-oxc",
        "facts",
        "primitives",
        "lints",
        "static-compiler",
        "worker",
    ] {
        assert!(
            crates.join(name).join("Cargo.toml").is_file(),
            "expected root Rust crate crates/{name}"
        );
    }

    for path in [
        repo_root.join("packages/local/crates"),
        repo_root.join("packages/indexer/crates"),
        repo_root.join("packages/local/internal/projectindex/crates"),
    ] {
        assert!(
            !path.exists(),
            "Rust crates must stay top-level instead of moving under {}",
            path.display()
        );
    }
}

#[test]
fn primitives_crate_does_not_depend_on_syntax_frontend() {
    let static_compiler_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let primitives_manifest = static_compiler_dir
        .parent()
        .expect("static compiler crate should live under crates/")
        .join("primitives/Cargo.toml");
    let manifest = std::fs::read_to_string(&primitives_manifest)
        .expect("primitives manifest should be readable");

    assert!(
        !manifest.contains("crux-indexer-syntax-oxc"),
        "crux-indexer-primitives must project from Static Syntax evidence without depending on \
         the Oxc syntax frontend"
    );
}

#[test]
fn lints_crate_consumes_prepared_inputs_without_file_io() {
    let static_compiler_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let lints_src = static_compiler_dir
        .parent()
        .expect("static compiler crate should live under crates/")
        .join("lints/src");

    for path in rust_files_under(&lints_src) {
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        assert!(
            !source.contains("std::fs")
                && !source.contains("fs::read")
                && !source.contains("File::open"),
            "crux-indexer-lints must consume prepared lint inputs without reading files directly: {}",
            path.display()
        );
    }
}

#[test]
fn rust_crate_manifests_follow_static_index_dependency_direction() {
    let static_compiler_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let crates = static_compiler_dir
        .parent()
        .expect("static compiler crate should live under crates/");

    assert_manifest_excludes(
        &crates.join("primitives/Cargo.toml"),
        &["crux-indexer-syntax-oxc", "crux-indexer-lints"],
    );
    assert_manifest_excludes(
        &crates.join("lints/Cargo.toml"),
        &[
            "crux-indexer-protocol",
            "crux-indexer-syntax-oxc",
            "crux-indexer-primitives",
            "crux-indexer-static-compiler",
        ],
    );
    assert_manifest_includes(
        &crates.join("static-compiler/Cargo.toml"),
        &[
            "crux-indexer-protocol",
            "crux-indexer-facts",
            "crux-indexer-syntax-oxc",
            "crux-indexer-primitives",
            "crux-indexer-lints",
        ],
    );
    assert_manifest_excludes(
        &crates.join("worker/Cargo.toml"),
        &[
            "crux-indexer-facts",
            "crux-indexer-syntax-oxc",
            "crux-indexer-primitives",
            "crux-indexer-lints",
        ],
    );
}

#[test]
fn finalizer_run_does_not_construct_patch_events() {
    let static_compiler_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let finalizer_run = static_compiler_dir.join("src/finalizer/run.rs");
    let source =
        std::fs::read_to_string(&finalizer_run).expect("finalizer run source should be readable");

    assert!(
        !source.contains("\"fact:batch\"") && !source.contains("\"transactionId\""),
        "crates/static-compiler/src/finalizer/events.rs must be the only Static Index patch-event \
         construction boundary"
    );
}

fn rust_files_under(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(path) = pending.pop() {
        for entry in std::fs::read_dir(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
        {
            let entry = entry.expect("directory entry should be readable");
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

fn assert_manifest_includes(path: &std::path::Path, packages: &[&str]) {
    let manifest = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    for package in packages {
        assert!(
            manifest.contains(package),
            "{} should depend on {package}",
            path.display()
        );
    }
}

fn assert_manifest_excludes(path: &std::path::Path, packages: &[&str]) {
    let manifest = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    for package in packages {
        assert!(
            !manifest.contains(package),
            "{} should not depend on {package}",
            path.display()
        );
    }
}

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
