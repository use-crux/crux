use std::fs;
use std::path::{Path, PathBuf};

fn crate_src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn crate_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
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
        for module in ["protocol", "primitives", "index_compiler", "worker"] {
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
        "protocol" | "primitives" | "index_compiler" | "worker"
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
    let crate_dir = crate_dir();
    let src = crate_src();
    let crates = crates_dir();

    assert_eq!(
        crate_dir.file_name().and_then(|name| name.to_str()),
        Some("worker"),
        "worker crate folder should stay crates/worker; the package/bin rename is tracked as Phase 7 migration state"
    );

    let expected_files = [
        (crates.join("protocol/src"), "worker.rs"),
        (crates.join("protocol/src"), "static_syntax.rs"),
        (crates.join("protocol/src"), "static_index.rs"),
        (crates.join("syntax-oxc/src"), "syntax/frontend.rs"),
        (crates.join("facts/src"), "lib.rs"),
        (crates.join("primitives/src"), "projection.rs"),
        (crates.join("lints/src"), "findings.rs"),
        (crates.join("lints/src"), "builtin_rule_descriptors.json"),
        (crates.join("static-compiler/src"), "lib.rs"),
        (
            crates.join("static-compiler/src"),
            "compat/static_syntax.rs",
        ),
        (crates.join("static-compiler/src"), "pipeline.rs"),
        (crates.join("static-compiler/src"), "finalizer/run.rs"),
        (src.clone(), "worker/mod.rs"),
        (src.clone(), "worker/static_syntax.rs"),
        (src.clone(), "worker/static_index.rs"),
    ];
    for (root, path) in expected_files {
        assert!(
            root.join(path).is_file(),
            "expected Rust responsibility boundary file {}/{}",
            root.display(),
            path
        );
    }

    for (current, target, phase, note) in [
        (
            crates.join("protocol/src/worker.rs"),
            crates.join("protocol/src/process.rs"),
            7,
            "process-level JSONL envelopes",
        ),
        (
            crates.join("protocol/src/worker.rs"),
            crates.join("protocol/src/project_index_events.rs"),
            7,
            "Project Index worker event stream ABI",
        ),
        (
            src.join("bin/crux-indexer-worker.rs"),
            src.join("bin/crux-static-index-worker.rs"),
            7,
            "Static Index worker binary",
        ),
    ] {
        assert!(
            current.is_file(),
            "current Rust path {} must remain explicit until Phase {phase} moves it to {} ({note})",
            current.display(),
            target.display()
        );
        assert!(
            !target.exists(),
            "target Rust path {} exists before Phase {phase} updates this pending inventory ({note})",
            target.display()
        );
    }

    for path in [
        "worker/mod.rs",
        "worker/static_syntax.rs",
        "worker/static_index.rs",
    ] {
        assert!(
            src.join(path).is_file(),
            "expected Rust responsibility boundary file {path}"
        );
    }

    let old_paths = [
        crates.join("crux-indexer-worker"),
        crates.join("extractors"),
        src.join("index_compiler"),
        src.join("serve.rs"),
        src.join("server"),
        src.join("static_index"),
        src.join("protocol"),
        src.join("syntax"),
        src.join("lints"),
        src.join("syntax/extract.rs"),
        src.join("protocol/static_compile.rs"),
        src.join("protocol/static_compiler.rs"),
        src.join("protocol/syntax_record.rs"),
        src.join("protocol/syntax_worker.rs"),
    ];
    for path in old_paths {
        assert!(
            !path.exists(),
            "old Rust responsibility boundary path should be removed: {}",
            path.display()
        );
    }
}

#[test]
fn rust_worker_binary_rename_is_phase_7_pending_inventory() {
    let manifest = fs::read_to_string(crate_dir().join("Cargo.toml"))
        .expect("worker crate manifest should be readable");

    assert!(
        manifest.contains("name = \"crux-indexer-worker\""),
        "current worker package name must remain explicit until Phase 7 renames it"
    );
    assert!(
        !manifest.contains("crux-static-index-worker"),
        "target worker package/bin name should appear only after Phase 7 updates scripts and tests"
    );
}

#[test]
fn rust_responsibility_modules_follow_dependency_direction() {
    assert_no_forbidden_crate_uses("worker", &["index_compiler", "primitives"], &[]);
    let static_index_transport = fs::read_to_string(crate_src().join("worker/static_index.rs"))
        .expect("Static Index transport source should be readable");
    assert!(
        static_index_transport.contains("crux_indexer_static_compiler::pipeline"),
        "worker transport should call the extracted static compiler crate"
    );
}
