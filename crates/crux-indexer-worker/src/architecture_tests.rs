use std::fs;
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

fn crates_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("worker crate should live under crates/")
        .to_path_buf()
}

fn rust_files_under(root: &Path) -> Vec<PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(&path).unwrap_or_else(|error| {
            panic!("failed to read {}: {error}", path.display());
        }) {
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

fn crate_use_targets(source: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut grouped = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("use crate::{") {
            grouped = true;
            continue;
        }
        if grouped {
            if trimmed.starts_with("};") {
                grouped = false;
                continue;
            }
            if let Some(target) = top_level_use_target(trimmed) {
                targets.push(target);
            }
            continue;
        }
        for module in [
            "protocol",
            "syntax",
            "extractors",
            "index_compiler",
            "lints",
            "worker",
        ] {
            if trimmed.contains(&format!("crate::{module}::"))
                || trimmed.contains(&format!("crate::{module};"))
            {
                targets.push(module.to_string());
            }
        }
    }
    targets
}

fn top_level_use_target(line: &str) -> Option<String> {
    if line.starts_with("self::") || line.starts_with("super::") {
        return None;
    }
    let target = line
        .split([':', ',', '{', '}', ' '])
        .find(|part| !part.is_empty())?;
    matches!(
        target,
        "protocol" | "syntax" | "extractors" | "index_compiler" | "lints" | "worker"
    )
    .then(|| target.to_string())
}

fn assert_no_forbidden_crate_uses(module: &str, forbidden: &[&str], allowed_files: &[&str]) {
    let src = crate_src();
    for path in rust_files_under(&src.join(module)) {
        let relative = path.strip_prefix(&src).unwrap().to_string_lossy();
        if allowed_files.iter().any(|allowed| relative == *allowed) {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!("failed to read {}: {error}", path.display());
        });
        let imports = crate_use_targets(&source);
        for forbidden_module in forbidden {
            assert!(
                !imports.iter().any(|target| target == forbidden_module),
                "{} must not import crate::{forbidden_module}; imports: {:?}",
                relative,
                imports
            );
        }
    }
}

#[test]
fn rust_runtime_boundaries_use_responsibility_module_names() {
    let src = crate_src();
    let crates = crates_dir();

    let expected_files = [
        (crates.join("protocol/src"), "worker.rs"),
        (crates.join("protocol/src"), "static_syntax.rs"),
        (crates.join("protocol/src"), "native_static.rs"),
        (crates.join("syntax-oxc/src"), "syntax/frontend.rs"),
        (crates.join("facts/src"), "lib.rs"),
        (crates.join("extractors/src"), "projection.rs"),
        (crates.join("extractors/src"), "static_syntax.rs"),
        (crates.join("lints/src"), "findings.rs"),
        (crates.join("lints/src"), "builtin_rule_descriptors.json"),
        (src.clone(), "worker/mod.rs"),
        (src.clone(), "worker/static_syntax.rs"),
        (src.clone(), "worker/native_static.rs"),
        (src.clone(), "index_compiler/mod.rs"),
        (src.clone(), "index_compiler/pipeline.rs"),
        (src.clone(), "index_compiler/finalizer/run.rs"),
    ];
    for (root, path) in expected_files {
        assert!(
            root.join(path).is_file(),
            "expected Rust responsibility boundary file {}/{}",
            root.display(),
            path
        );
    }

    for path in [
        "worker/mod.rs",
        "worker/static_syntax.rs",
        "worker/native_static.rs",
        "index_compiler/mod.rs",
        "index_compiler/pipeline.rs",
        "index_compiler/finalizer/run.rs",
    ] {
        assert!(
            src.join(path).is_file(),
            "expected Rust responsibility boundary file {path}"
        );
    }

    for path in [
        "serve.rs",
        "server",
        "native_static",
        "static_compiler",
        "primitives",
        "protocol",
        "syntax",
        "extractors",
        "lints",
        "syntax/extract.rs",
        "protocol/static_compile.rs",
        "protocol/static_compiler.rs",
        "protocol/syntax_record.rs",
        "protocol/syntax_worker.rs",
    ] {
        assert!(
            !src.join(path).exists(),
            "old Rust responsibility boundary path should be removed: {path}"
        );
    }
}

#[test]
fn rust_responsibility_modules_follow_dependency_direction() {
    assert_no_forbidden_crate_uses("index_compiler", &["worker"], &[]);
}

#[test]
fn phase9_syntax_frontend_is_pure_and_native_static_pipeline_projects_facts() {
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

    let output = crate::index_compiler::pipeline::analyze(&NativeStaticAnalyzeRequest {
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
        "index compiler pipeline should own first-party extractor projection"
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
